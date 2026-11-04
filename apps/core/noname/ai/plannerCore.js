/**
 * 出牌阶段规划器的核心（纯逻辑，不依赖游戏引擎，便于单独测试）。
 *
 * 思路：把局面抽象成“期望状态”（体力、手牌数允许是小数），枚举本回合所有可执行的动作，
 * 对动作序列做深度受限、带剪枝的前向搜索，用估值函数 E(state) 计算收益，
 * 选出期望收益最高的序列，并只返回其中的第一步（执行后会基于真实局面重新规划）。
 *
 * 状态格式见 `makeState` 的注释。
 */

/** 体力价值表：下标为体力，濒死/阵亡为负。边际价值递减，低体力时每点体力更值钱。 */
const HP_TABLE = [-4.5, 2, 4.2, 6, 7.4, 8.5, 9.4, 10.1, 10.7];

/** 手牌留存价值（留到回合结束仍然持有时的价值）。 */
const KEEP_VALUE = {
	sha: 0.9,
	shan: 1.1,
	tao: 1.8,
	jiu: 0.8,
	wuzhong: 1.4,
	juedou: 1.1,
	nanman: 1.0,
	wanjian: 1.0,
	guohe: 0.9,
	shunshou: 1.0,
	lebu: 1.0,
	bingliang: 0.9,
	equip: 0.8,
	other: 0.9,
};

/** 对手手牌里一张牌的价值（用于计算打出、拆除、顺走手牌的收益）。 */
const FOE_CARD_VALUE = 1.2;
/** 未知手牌里“杀 / 闪”的占比估计。 */
const SHA_RATE = 0.22;
const SHAN_RATE = 0.2;
/** 新摸到的未知牌价值。 */
const DRAWN_VALUE = 1.0;

/**
 * @typedef {Object} PlanPlayer
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} hand 手牌数（允许小数，表示期望）
 * @property {number} [weight] 立场权重：>0 为友方，<0 为敌方，绝对值越大越重要（仅 others 使用）
 * @property {Object<string, boolean>} [can] 我能否对其使用某种牌（sha/guohe/shunshou/juedou/lebu/bingliang）
 * @property {boolean} [lebu] 是否已被乐不思蜀
 */

/**
 * 状态：
 * {
 *   me: { hp, maxHp, hand: string[], shaLeft, jiu, slots: {equip1: bool,...}, usable: {tao, jiu, wuzhong, nanman, wanjian, equip1..: bool} },
 *   others: PlanPlayer[],
 *   handLimit: number  // 回合结束时的手牌上限（=体力）
 * }
 */

/**
 * @param {number} hp
 */
export function hpValue(hp) {
	if (hp <= 0) {
		return HP_TABLE[0] + hp * 0.5;
	}
	const max = HP_TABLE.length - 1;
	if (hp >= max) {
		return HP_TABLE[max];
	}
	const lo = Math.floor(hp);
	const frac = hp - lo;
	return HP_TABLE[lo] * (1 - frac) + HP_TABLE[lo + 1] * frac;
}

/**
 * @param {string} name
 */
function keepValue(name) {
	if (name.startsWith("equip")) {
		return KEEP_VALUE.equip;
	}
	if (name.startsWith("conv:")) {
		return KEEP_VALUE.other;
	}
	return KEEP_VALUE[name] ?? KEEP_VALUE.other;
}

/**
 * 回合结束时，超出手牌上限的牌需要弃置（弃价值最低的）。
 * @param {string[]} hand
 * @param {number} limit
 */
function discardPenalty(hand, limit) {
	const excess = hand.length - Math.max(0, Math.floor(limit));
	if (excess <= 0) {
		return 0;
	}
	const values = hand.map(keepValue).sort((a, b) => a - b);
	let sum = 0;
	for (let i = 0; i < excess; i++) {
		sum += values[i];
	}
	return sum;
}

/**
 * 估值：以“我”的立场看当前局面的好坏。
 * @param {any} state
 * @param {boolean} [terminal] 是否为回合结束（需要计入弃牌惩罚）
 */
export function evaluate(state, terminal = false) {
	const me = state.me;
	let total = hpValue(me.hp);
	for (const name of me.hand) {
		total += keepValue(name);
	}
	if (terminal) {
		total -= discardPenalty(me.hand, me.hp);
	}
	for (const other of state.others) {
		const weight = other.weight ?? 0;
		let value = hpValue(other.hp) + other.hand * FOE_CARD_VALUE * 0.8;
		if (other.lebu) {
			value -= 1.5;
		}
		total += weight * value;
	}
	return total;
}

/**
 * @param {any} state
 */
function clone(state) {
	return {
		me: { ...state.me, hand: state.me.hand.slice(), slots: { ...state.me.slots }, usable: state.me.usable },
		others: state.others.map(other => ({ ...other })),
		handLimit: state.handLimit,
		skills: state.skills,
	};
}

/**
 * 至少有 n 张牌是目标期望持有的某类牌的概率近似（用于估计对手能否响应）。
 * @param {number} hand
 * @param {number} rate
 */
function respondRate(hand, rate) {
	if (hand <= 0) {
		return 0;
	}
	return 1 - Math.pow(1 - rate, hand);
}

/**
 * @param {any} state
 * @param {string} name
 */
function removeCard(state, name) {
	let index = state.me.hand.indexOf(name);
	if (index < 0) {
		//技能转化出来的牌（conv:牌名）
		index = state.me.hand.indexOf(`conv:${name}`);
	}
	if (index < 0) {
		return false;
	}
	state.me.hand.splice(index, 1);
	return true;
}

/**
 * 伤害目标（期望状态，体力允许小数）。
 * @param {any} target
 * @param {number} amount
 */
function hurt(target, amount) {
	target.hp -= amount;
}

/**
 * 生成当前状态下所有可执行的动作，并给出执行后的期望新状态。
 * @param {any} state
 * @returns {{ name: string, slot?: string, targets: number[], next: any }[]}
 */
export function generateActions(state) {
	const actions = [];
	const me = state.me;
	const names = new Set(me.hand);
	for (const name of me.hand) {
		if (name.startsWith("conv:")) {
			names.add(name.slice(5));
		}
	}

	const push = (name, targets, mutate, slot) => {
		const next = clone(state);
		//装备牌在手牌中以栏位名（equip1…equip6）表示
		if (!removeCard(next, slot ?? name)) {
			return;
		}
		mutate(next);
		actions.push({ name, slot, targets, next });
	};

	// 杀：对每个可攻击的目标
	if (names.has("sha") && me.shaLeft > 0) {
		state.others.forEach((target, index) => {
			if (!target.can?.sha) {
				return;
			}
			const damage = me.jiu ? 2 : 1;
			const hit = 1 - respondRate(target.hand, SHAN_RATE);
			push("sha", [index], next => {
				next.me.shaLeft -= 1;
				next.me.jiu = false;
				const t = next.others[index];
				hurt(t, hit * damage);
				// 被闪掉时，对方消耗一张闪
				t.hand = Math.max(0, t.hand - (1 - hit) * Math.min(1, t.hand));
			});
		});
	}

	// 酒：只有手里还有杀、还能出杀时才有意义
	if (names.has("jiu") && me.usable.jiu && !me.jiu && me.shaLeft > 0 && names.has("sha")) {
		push("jiu", [], next => {
			next.me.jiu = true;
		});
	}

	// 桃：受伤时回复
	if (names.has("tao") && me.usable.tao && me.hp < me.maxHp) {
		push("tao", [], next => {
			next.me.hp = Math.min(next.me.maxHp, next.me.hp + 1);
		});
	}

	// 无中生有：摸两张未知牌
	if (names.has("wuzhong") && me.usable.wuzhong) {
		push("wuzhong", [], next => {
			next.me.hand.push("other", "other");
		});
	}

	// 决斗：比拼杀的数量
	if (names.has("juedou")) {
		state.others.forEach((target, index) => {
			if (!target.can?.juedou) {
				return;
			}
			const mine = me.hand.filter(name => name === "sha" || name === "conv:sha").length;
			const theirs = target.hand * SHA_RATE;
			const win = 1 / (1 + Math.exp(-(mine - theirs - 0.3) * 1.4));
			push("juedou", [index], next => {
				const t = next.others[index];
				const used = Math.min(mine, theirs + 1);
				for (let i = 0; i < Math.floor(used); i++) {
					removeCard(next, "sha");
				}
				t.hand = Math.max(0, t.hand - Math.min(t.hand, theirs));
				hurt(t, win);
				next.me.hp -= 1 - win;
			});
		});
	}

	// 南蛮入侵 / 万箭齐发：对所有其他角色
	for (const [name, rate] of [
		["nanman", SHA_RATE],
		["wanjian", SHAN_RATE],
	]) {
		if (names.has(name) && me.usable[name]) {
			push(name, [], next => {
				for (const t of next.others) {
					const response = respondRate(t.hand, rate);
					hurt(t, 1 - response);
					t.hand = Math.max(0, t.hand - response * Math.min(1, t.hand));
				}
			});
		}
	}

	// 过河拆桥 / 顺手牵羊
	for (const name of ["guohe", "shunshou"]) {
		if (!names.has(name)) {
			continue;
		}
		state.others.forEach((target, index) => {
			if (!target.can?.[name] || target.hand < 0.5) {
				return;
			}
			push(name, [index], next => {
				next.others[index].hand -= 1;
				if (name === "shunshou") {
					next.me.hand.push("other");
				}
			});
		});
	}

	// 乐不思蜀 / 兵粮寸断：限制对手
	for (const name of ["lebu", "bingliang"]) {
		if (!names.has(name)) {
			continue;
		}
		state.others.forEach((target, index) => {
			if (!target.can?.[name] || target.lebu || (target.weight ?? 0) >= 0) {
				return;
			}
			push(name, [index], next => {
				next.others[index].lebu = true;
			});
		});
	}

	// 装备牌：对应栏位为空时有明显收益，已有装备时只有轻微收益
	for (const slot of new Set(me.hand.filter(name => name.startsWith("equip")))) {
		if (!me.usable[slot]) {
			continue;
		}
		push(
			"equip",
			[],
			next => {
				next.me.bonus = (next.me.bonus ?? 0) + (me.slots[slot] ? 0.4 : 1.8);
				next.me.slots[slot] = true;
			},
			slot
		);
	}

	// 通用主动技能：收益来自技能自身AI的估值（已换算到规划器的单位），消耗若干张手牌，每个技能一次搜索序列内最多发动一次
	for (const skill of state.skills ?? []) {
		if (me.usedSkills?.[skill.id] || me.hand.length < skill.cardCost) {
			continue;
		}
		const options = skill.targets ?? [{ index: -1, gain: skill.gain ?? 0 }];
		for (const option of options) {
			if (!(option.gain > 0)) {
				continue;
			}
			const next = clone(state);
			if (skill.cardCost > 0) {
				// 消耗价值最低的牌
				const sorted = next.me.hand.map((name, index) => ({ index, value: keepValue(name) })).sort((a, b) => a.value - b.value);
				const remove = sorted.slice(0, skill.cardCost).map(item => item.index).sort((a, b) => b - a);
				for (const index of remove) {
					next.me.hand.splice(index, 1);
				}
			}
			next.me.usedSkills = { ...next.me.usedSkills, [skill.id]: true };
			next.me.bonus = (next.me.bonus ?? 0) + option.gain;
			actions.push({ name: `skill:${skill.id}`, targets: option.index >= 0 ? [option.index] : [], next });
		}
	}

	return actions;
}

/**
 * 装备、技能带来的额外收益（bonus）需要计入估值。
 * @param {any} state
 * @param {boolean} terminal
 */
function score(state, terminal) {
	return evaluate(state, terminal) + (state.me.bonus ?? 0);
}

/**
 * 前向搜索。
 * @param {any} state
 * @param {number} depth
 * @param {{ nodes: number, limit: number, beam: number }} ctx
 * @returns {{ value: number, first: any }}
 */
function search(state, depth, ctx) {
	let best = { value: score(state, true), first: null };
	if (depth <= 0 || ctx.nodes >= ctx.limit) {
		return best;
	}
	const actions = generateActions(state);
	if (!actions.length) {
		return best;
	}
	// 用立即收益排序并剪枝，只展开最有希望的几个动作
	const base = score(state, false);
	const ranked = actions
		.map(action => ({ action, gain: score(action.next, false) - base }))
		.sort((a, b) => b.gain - a.gain)
		.slice(0, ctx.beam);
	for (const { action } of ranked) {
		ctx.nodes++;
		const result = search(action.next, depth - 1, ctx);
		if (result.value > best.value + 1e-9) {
			best = { value: result.value, first: action };
		}
	}
	return best;
}

/**
 * 计算某个动作在当前状态下的即时收益（用于把技能AI的估值换算到规划器的单位）。
 * @param {any} state
 * @param {(action: { name: string, targets: number[] }) => boolean} predicate
 * @returns {number | null}
 */
export function immediateGain(state, predicate) {
	const base = score(state, false);
	let best = null;
	for (const action of generateActions(state)) {
		if (!predicate(action)) {
			continue;
		}
		const gain = score(action.next, false) - base;
		if (best === null || gain > best) {
			best = gain;
		}
	}
	return best;
}

/**
 * 规划出牌阶段。
 * @param {any} state
 * @param {{ depth?: number, beam?: number, limit?: number }} [options]
 * @returns {{ action: { name: string, slot?: string, targets: number[] } | null, value: number, endValue: number }}
 */
export function plan(state, options = {}) {
	const ctx = { nodes: 0, limit: options.limit ?? 20000, beam: options.beam ?? 5 };
	const endValue = score(state, true);
	const result = search(state, options.depth ?? 5, ctx);
	return {
		action: result.first ? { name: result.first.name, slot: result.first.slot, targets: result.first.targets } : null,
		value: result.value,
		endValue,
	};
}

/** 规划器建模的牌名（其余牌和技能仍由原有 AI 处理）。 */
export const MODELED = new Set(["sha", "jiu", "tao", "wuzhong", "juedou", "nanman", "wanjian", "guohe", "shunshou", "lebu", "bingliang"]);
