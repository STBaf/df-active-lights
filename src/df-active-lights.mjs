import SETTINGS from "../common/Settings.mjs";
import ActiveLightConfig from "./ActiveLightConfig.mjs";
import LightAnimator from "./LightAnimator.mjs";

SETTINGS.init('df-active-lights');

Hooks.once('init', function () {
	SETTINGS.register('enabled', {
		config: false,
		scope: 'world',
		type: Boolean,
		default: true,
		onChange: value => LightAnimator.onEnabledChanged(value)
	});
	LightAnimator.init();
	ActiveLightConfig.init();
});

Hooks.once('ready', function () {
	LightAnimator.ready();
});

/**
 * Toggle button in the Lighting controls.
 * Since v13 `controls` is a record keyed by control name and `tools` is a record keyed by tool name.
 * Toggle tools use `onChange(event, active)` instead of the old `onClick(toggled)`.
 */
Hooks.on('getSceneControlButtons', controls => {
	if (!game.user?.isGM) return;
	const lighting = Array.isArray(controls) ? controls.find(x => x.name === 'lighting') : controls?.lighting;
	if (!lighting?.tools) return;

	const tool = {
		name: 'df-active-lights',
		title: 'DF_ACTIVE_LIGHTS.animationToggleTitle',
		icon: 'fa-solid fa-video',
		toggle: true,
		active: SETTINGS.get('enabled'),
		visible: true,
		onChange: (_event, active) => SETTINGS.set('enabled', !!active)
	};

	if (Array.isArray(lighting.tools)) {
		// Legacy layout (<= v12), kept only as a safety net
		tool.onClick = toggled => SETTINGS.set('enabled', !!toggled);
		lighting.tools.push(tool);
	} else {
		tool.order = Object.keys(lighting.tools).length + 1;
		lighting.tools[tool.name] = tool;
	}
});
