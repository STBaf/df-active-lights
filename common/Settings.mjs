/**
 * Small helper around game.settings for the DragonFlagon modules.
 * v14 port: the module id is known up-front so that classes which need it at
 * import time (e.g. ApplicationV2 PARTS) can use it before init() is called.
 */
export default class SETTINGS {
	/** @type {string} */
	static MOD_NAME = 'df-active-lights';

	/** @param {string} moduleName */
	static init(moduleName) {
		this.MOD_NAME = moduleName;
	}
	/**
	 * @param {string} key
	 * @param {object} config
	 */
	static register(key, config) { game.settings.register(SETTINGS.MOD_NAME, key, config); }
	/**
	 * @param {string} key
	 * @param {object} config
	 */
	static registerMenu(key, config) { game.settings.registerMenu(SETTINGS.MOD_NAME, key, config); }
	/**
	 * @param {string} key
	 * @returns {any}
	 */
	static get(key) { return game.settings.get(SETTINGS.MOD_NAME, key); }
	/**
	 * @param {string} key
	 * @param {any} value
	 * @returns {Promise<any>}
	 */
	static async set(key, value) { return await game.settings.set(SETTINGS.MOD_NAME, key, value); }
	/**
	 * @param {string} key
	 * @returns {any}
	 */
	static default(key) { return game.settings.settings.get(`${SETTINGS.MOD_NAME}.${key}`)?.default; }
}
