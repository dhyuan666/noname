import { _status, game, get, lib } from "noname";
import { CacheContext } from "@/library/cache/cacheContext.js";
import { plan, immediateGain, MODELED } from "./plannerCore.js";

/**
 * 出牌阶段规划器：把真实局面转换为 plannerCore 的抽象状态，搜索收益最高的出牌序列，
 * 并通过覆盖 chooseToUse 的 ai1 / ai2 来执行序列中的第一步。
 *
 * 规划器只建模常见的基本牌和锦囊，建模之外的牌与技能仍由原有 AI 决定。
 * 可通过 `game.saveConfig("ai_planner", false)` 关闭。
 */
export class Planner {
	/**
	 * @returns {boolean}
	 */
	isEnabled() {
		return lib.config.ai_planner !== false;
	}

	/**
	 * 牌在规划器中的键：建模的牌用牌名，装备牌用栏位名（equip1…），其余为 null。
	 * @param { any } card
	 * @returns { string | null }
	 */
	cardKey(card) {
		if (!card || typeof card !== "object") {
			return null;
		}
		if (MODELED.has(card.name)) {
			return card.name;
		}
		if (get.type(card) === "equip") {
			return get.subtype(card) || null;
		}
		return null;
	}

	/**
	 * @param { Player } player
	 */
	buildState(player) {
		/** @type { Record<string, boolean> } */
		const usable = {};
		/** @type { Record<string, boolean> } */
		const slots = {};
		const hand = [];
		const samples = {};
		for (const card of player.getCards("h")) {
			const key = this.cardKey(card);
			if (key === null) {
				hand.push("other");
				continue;
			}
			samples[key] ??= card;
			hand.push(key);
		}
		for (const key of Object.keys(samples)) {
			usable[key] = !!player.hasUseTarget(samples[key], undefined, true);
			if (key.startsWith("equip")) {
				slots[key] = player.getCards("e").some(card => get.subtype(card) === key);
			}
		}
		const { convSkills, genericSkills } = this.classifySkills(player);
		//技能可以把“其他”牌转化为建模的牌（如武圣把红色牌当杀）
		const converted = new Set();
		for (const [name, skill] of convSkills) {
			const info = get.info(skill);
			player.getCards("h").forEach((card, index) => {
				if (hand[index] !== "other") {
					return;
				}
				let pass = true;
				if (typeof info.filterCard === "function") {
					try {
						pass = !!info.filterCard(card, player);
					} catch (error) {
						pass = false;
					}
				} else if (info.filterCard !== undefined && info.filterCard !== true) {
					pass = false;
				}
				if (pass) {
					hand[index] = `conv:${name}`;
					converted.add(name);
				}
			});
		}
		for (const name of converted) {
			samples[name] ??= { name, isCard: true };
			usable[name] ??= !!player.hasUseTarget(samples[name], undefined, true);
		}
		const sampleSha = samples.sha ?? { name: "sha", isCard: true };
		const shaLeft = player.getCardUsable(sampleSha);
		const others = game.filterPlayer(current => current !== player);
		const can = (name, target) => {
			const card = samples[name];
			if (!card) {
				return false;
			}
			try {
				return !!player.canUse(card, target, null, true);
			} catch (error) {
				return false;
			}
		};
		const state = {
			me: {
				hp: player.hp,
				maxHp: player.maxHp,
				hand,
				shaLeft: Number.isFinite(shaLeft) ? shaLeft : 99,
				jiu: player.hasSkill("jiu"),
				slots,
				usable,
			},
			others: others.map(target => {
				const attitude = get.attitude(player, target);
				return {
					hp: target.hp,
					maxHp: target.maxHp,
					hand: target.countCards("h"),
					weight: Math.max(-1.5, Math.min(1.5, attitude / 6)),
					lebu: target.hasJudge("lebu"),
					can: {
						sha: can("sha", target),
						guohe: can("guohe", target),
						shunshou: can("shunshou", target),
						juedou: can("juedou", target),
						lebu: can("lebu", target),
						bingliang: can("bingliang", target),
					},
				};
			}),
			handLimit: player.hp,
			skills: [],
			_others: others,
		};
		state.skills = this.buildSkillActions(player, state, genericSkills);
		return state;
	}

	/**
	 * 把当前可发动的技能分为：转化牌技能、可建模的通用主动技能。
	 * @param { Player } player
	 * @returns { { convSkills: Map<string, string>, genericSkills: string[] } }
	 */
	classifySkills(player) {
		/** @type { Map<string, string> } */
		const convSkills = new Map();
		/** @type { string[] } */
		const genericSkills = [];
		for (const skill of new Set(get.skills())) {
			const info = typeof skill === "string" ? get.info(skill) : null;
			if (!info) {
				continue;
			}
			if (info.viewAs && typeof info.viewAs === "object") {
				if (MODELED.has(info.viewAs.name) && !convSkills.has(info.viewAs.name)) {
					convSkills.set(info.viewAs.name, skill);
				}
				continue;
			}
			if (info.chooseButton || info.viewAs || typeof info.selectCard === "function") {
				continue;
			}
			if (!info.ai || !info.ai.result) {
				continue;
			}
			if (info.selectTarget !== undefined && !(info.selectTarget === 1 || (Array.isArray(info.selectTarget) && info.selectTarget[0] === 1 && info.selectTarget[1] === 1))) {
				if (info.selectTarget !== 0 && info.filterTarget) {
					continue;
				}
			}
			if (info.filterCard && get.select(info.selectCard)[0] !== get.select(info.selectCard)[1]) {
				continue;
			}
			genericSkills.push(skill);
		}
		return { convSkills, genericSkills };
	}

	/**
	 * 用技能自身的AI估值给通用主动技能打分，并换算到规划器的单位。
	 * @param { Player } player
	 * @param { any } state
	 * @param { string[] } skills
	 */
	buildSkillActions(player, state, skills) {
		if (!skills.length) {
			return [];
		}
		const others = state._others;
		CacheContext.setCacheContext(new CacheContext({ lib, game, get }));
		CacheContext.setInCacheEnvironment(true);
		try {
			// 以“杀”为参照，估计技能AI的估值单位与规划器收益单位的换算比例
			let scale = 0.35;
			const sha = player.getCards("h", "sha")[0];
			if (sha) {
				const reference = immediateGain(state, action => action.name === "sha");
				let effect = 0;
				for (const target of others) {
					if (player.canUse(sha, target, null, true)) {
						effect = Math.max(effect, get.cacheEffectUse(target, sha, player));
					}
				}
				if (reference > 0 && effect > 0) {
					scale = Math.max(0.1, Math.min(1.5, reference / effect));
				}
			}
			const result = [];
			for (const id of skills) {
				const info = get.info(id);
				const cardCost = info.filterCard ? get.select(info.selectCard)[0] : 0;
				try {
					if (info.filterTarget && info.selectTarget !== 0) {
						const targets = [];
						others.forEach((target, index) => {
							if (!info.filterTarget(null, player, target)) {
								return;
							}
							const gain = get.cacheEffectUse(target, id, player) * scale;
							if (gain > 0) {
								targets.push({ index, gain });
							}
						});
						if (targets.length) {
							result.push({ id, cardCost, targets });
						}
					} else {
						const gain = get.cacheEffectUse(undefined, id, player) * scale;
						if (gain > 0) {
							result.push({ id, cardCost, gain });
						}
					}
				} catch (error) {
					// 技能AI依赖的上下文不满足时直接放弃建模，交给原有AI
				}
			}
			return result;
		} finally {
			CacheContext.setInCacheEnvironment(false);
			CacheContext.removeCacheContext();
		}
	}

	/**
	 * @param { Player } player
	 * @returns { { key: string | null, targets: Player[], value: number, endValue: number } }
	 */
	plan(player) {
		const state = this.buildState(player);
		const result = plan(state);
		const action = result.action;
		return {
			key: action ? (action.name === "equip" ? action.slot : action.name) : null,
			modeledSkills: new Set(state.skills.map(skill => skill.id)),
			convSkills: this.classifySkills(player).convSkills,
			targets: action ? action.targets.map(index => state._others[index]) : [],
			value: result.value,
			endValue: result.endValue,
		};
	}

	/**
	 * 在 AI 的出牌阶段 chooseToUse 事件上应用规划结果：
	 * 建模过的牌只有规划选中的那一种可以被使用，其余牌和技能保持原有 AI 行为。
	 * @param { GameEvent } event
	 * @param { Player } player
	 */
	apply(event, player) {
		if (!this.isEnabled() || event._plannerApplied) {
			return;
		}
		event._plannerApplied = true;
		let result;
		try {
			result = this.plan(player);
		} catch (error) {
			console.error("AI出牌规划失败，回退到默认AI", error);
			return;
		}
		if (lib.config.dev) {
			console.log("[planner]", get.translation(player), result.key, result.targets.map(t => get.translation(t)), (result.value - result.endValue).toFixed(2));
		}
		const originalAi1 = event.ai1;
		const originalAi2 = event.ai2;
		const skillName = skill => (result.modeledSkills.has(skill) ? `skill:${skill}` : null);
		event.ai1 = (...args) => {
			if (typeof args[0] === "string") {
				// 技能：建模过的主动技能由规划结果决定，转化牌技能按其转化出的牌处理
				const key = skillName(args[0]);
				if (key !== null) {
					return key === result.key ? 2000 : -1;
				}
				for (const [name, skill] of result.convSkills) {
					if (skill === args[0]) {
						return name === result.key ? 900 : -1;
					}
				}
				return originalAi1.apply(event, args);
			}
			const key = this.cardKey(args[0]);
			if (key === null) {
				return originalAi1.apply(event, args);
			}
			return key === result.key ? 1000 : -1;
		};
		event.ai2 = (...args) => {
			const key = event.skill && result.modeledSkills.has(event.skill) ? `skill:${event.skill}` : this.cardKey(get.card());
			if (key === null || key !== result.key) {
				return originalAi2.apply(event, args);
			}
			const [target] = args;
			if (!target || !result.targets.length) {
				return 100;
			}
			return result.targets.includes(target) ? 100 : -100;
		};
	}
}

export const planner = new Planner();
