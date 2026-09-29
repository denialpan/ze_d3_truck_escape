import { Entity, Instance } from "cs_script/point_script";

const CHECKPOINT_CONFIGS = {
    secret_kz: {
        inputPrefix: "secret_kz_checkpoint_",
        finalCheckpoint: 8,
        successRelay: "relay_secret_kz_success",
        failureRelay: "relay_secret_kz_failure",
        failureResetInput: "secret_kz_failure_reset",
        showTimer: true,
        timerLimit: 30,
        conflicts: ["normal_kz"]
    },
	
	normal_kz: {
        inputPrefix: "normal_kz_checkpoint_",
        finalCheckpoint: 2,
        successRelay: "relay_normal_kz_success",
        failureRelay: "relay_normal_kz_failure",
        failureResetInput: "normal_kz_failure_reset",
        showTimer: false,
        timerLimit: 0,
		conflicts: []
    }
};

const HUD_NAME = "hud_script_checkpoint_system";
const HUD_PANEL_ID = "script_checkpoint_timer";
const HUD_UPDATE_INTERVAL = 1 / 100;
const FAILURE_HOLD_TIME = 2;
const SUCCESS_HOLD_TIME = 10;

const progressByRun = new Map();
const timerByRun = new Map();
let checkpointHud = null;

function GetPlayerController(entity) {
    if (!entity) {
        return undefined;
    }

    if (typeof entity.GetPlayerSlot === "function") {
        return entity;
    }

    if (typeof entity.GetPlayerController === "function") {
        return entity.GetPlayerController();
    }

    if (typeof entity.GetOriginalPlayerController === "function") {
        return entity.GetOriginalPlayerController();
    }

    return undefined;
}

function FireRelay(name, player) {
    Instance.EntFireAtName({
        name,
        input: "Trigger",
        activator: player
    });
}

function GetCheckpointHud() {
    if (!(checkpointHud instanceof Entity) || !checkpointHud.IsValid()) {
        checkpointHud = Instance.FindEntitiesByName(HUD_NAME)[0];
    }
    return checkpointHud;
}

function FormatTime(seconds) {
    return Math.max(0, seconds).toFixed(3);
}

function SetTimerText(playerSlot, seconds) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetDialogVariableStringForPlayer(playerSlot, "timer_text", "kz_time", FormatTime(seconds));
}

function ShowTimer(playerSlot) {
    const layout = GetCheckpointHud();
    if (!layout) {
        Instance.Msg(`script_checkpoint_system.js: missing custom_hud_layout named ${HUD_NAME}`);
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", false);
}

function HideTimer(playerSlot) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", true);
}

function SetTimerState(playerSlot, stateClass) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerFailure", stateClass === "TimerFailure");
    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerSuccess", stateClass === "TimerSuccess");
}

function GetRunKey(systemId, playerSlot) {
    return `${systemId}:${playerSlot}`;
}

function StartTimer(runKey, systemId, player) {
    const now = Instance.GetGameTime();
    timerByRun.set(runKey, {
        systemId,
        player,
        playerSlot: player.GetPlayerSlot(),
        startTime: now,
        elapsed: 0,
        running: true,
        nextUpdate: 0,
        hideAt: 0
    });
    SetTimerState(player.GetPlayerSlot(), undefined);
    SetTimerText(player.GetPlayerSlot(), 0);
    ShowTimer(player.GetPlayerSlot());
    Instance.SetNextThink(now);
}

function IsTimerEnabled(config) {
    return config.showTimer === true;
}

function StopTimer(runKey) {
    const timer = timerByRun.get(runKey);
    if (!timer) {
        return 0;
    }

    timer.elapsed = Math.max(0, Instance.GetGameTime() - timer.startTime);
    timer.running = false;
    SetTimerText(timer.playerSlot, timer.elapsed);
    return timer.elapsed;
}

function ResetTimer(runKey, playerSlot) {
    timerByRun.delete(runKey);
    SetTimerState(playerSlot, undefined);
    SetTimerText(playerSlot, 0);
    HideTimer(playerSlot);
}

function HoldTimer(runKey, playerSlot, stateClass, holdTime) {
    const now = Instance.GetGameTime();
    const timer = timerByRun.get(runKey) || {
        playerSlot,
        startTime: now,
        elapsed: 0,
        running: false,
        nextUpdate: 0,
        hideAt: 0
    };

    timer.running = false;
    timer.hideAt = now + holdTime;
    timerByRun.set(runKey, timer);

    SetTimerText(playerSlot, timer.elapsed);
    SetTimerState(playerSlot, stateClass);
    ShowTimer(playerSlot);
    Instance.SetNextThink(now);
}

function ResetPlayerProgress(runKey) {
    progressByRun.delete(runKey);
}

function GetPlayerProgress(systemId, playerSlot) {
    return progressByRun.get(GetRunKey(systemId, playerSlot)) || 0;
}

function FailCheckpointSystem(systemId, config, player, reason) {
    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);

    ResetPlayerProgress(runKey);
    if (IsTimerEnabled(config)) {
        StopTimer(runKey);
        HoldTimer(runKey, playerSlot, "TimerFailure", FAILURE_HOLD_TIME);
    }

    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} failed ${systemId}${reason ? `; ${reason}` : ""}`);
    FireRelay(config.failureRelay, player);
}

function GetBlockingActiveConflict(systemId, playerSlot) {
    for (const [activeSystemId, activeConfig] of Object.entries(CHECKPOINT_CONFIGS)) {
        if (activeSystemId === systemId) {
            continue;
        }

        if (!(activeConfig.conflicts || []).includes(systemId)) {
            continue;
        }

        if (GetPlayerProgress(activeSystemId, playerSlot) > 0) {
            return activeSystemId;
        }
    }

    return undefined;
}

function FailureReset(systemId, activator) {
    const config = CHECKPOINT_CONFIGS[systemId];
    if (!config) {
        Instance.Msg(`script_checkpoint_system.js: missing checkpoint config "${systemId}"`);
        return;
    }

    const player = GetPlayerController(activator);
    if (!player) {
        Instance.Msg(`script_checkpoint_system.js: ${systemId} failure reset needs a player activator`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);
    const currentCheckpoint = progressByRun.get(runKey) || 0;

    if (currentCheckpoint === 0) {
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} failure reset; not started`);
        return;
    }

    FailCheckpointSystem(systemId, config, player, "failure reset input");
}

function TouchCheckpoint(systemId, checkpointNumber, activator) {
    const config = CHECKPOINT_CONFIGS[systemId];
    if (!config) {
        Instance.Msg(`script_checkpoint_system.js: missing checkpoint config "${systemId}"`);
        return;
    }

    const player = GetPlayerController(activator);
    if (!player) {
        Instance.Msg(`script_checkpoint_system.js: ${systemId} checkpoint_${checkpointNumber} needs a player activator`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);
    const currentCheckpoint = progressByRun.get(runKey) || 0;
    const expectedCheckpoint = currentCheckpoint + 1;

    if (currentCheckpoint === 0) {
        if (checkpointNumber !== 1) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} checkpoint_${checkpointNumber}; not started`);
            return;
        }

        const blockingConflict = GetBlockingActiveConflict(systemId, playerSlot);
        if (blockingConflict) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId}; active ${blockingConflict} has priority`);
            return;
        }
    }

    if (checkpointNumber === 1 && currentCheckpoint > 0) {
        progressByRun.set(runKey, 1);
        if (IsTimerEnabled(config)) {
            StartTimer(runKey, systemId, player);
        }
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} restarted ${systemId} at checkpoint_1`);
        return;
    }

    if (checkpointNumber <= currentCheckpoint) {
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored previous ${systemId} checkpoint_${checkpointNumber}`);
        return;
    }

    if (checkpointNumber !== expectedCheckpoint) {
        FailCheckpointSystem(systemId, config, player, `checkpoint_${checkpointNumber}`);
        return;
    }

    progressByRun.set(runKey, checkpointNumber);
    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} reached ${systemId} checkpoint_${checkpointNumber}`);

    if (checkpointNumber === 1 && IsTimerEnabled(config)) {
        StartTimer(runKey, systemId, player);
    }

    if (checkpointNumber === config.finalCheckpoint) {
        const elapsed = IsTimerEnabled(config) ? StopTimer(runKey) : 0;
        if (IsTimerEnabled(config)) {
            HoldTimer(runKey, playerSlot, "TimerSuccess", SUCCESS_HOLD_TIME);
        }
        ResetPlayerProgress(runKey);
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} completed ${systemId} in ${FormatTime(elapsed)}`);
        FireRelay(config.successRelay, player);
    }
}

function TimerThink() {
    const now = Instance.GetGameTime();
    let needsNextThink = false;

    for (const [runKey, timer] of timerByRun) {
        if (timer.running) {
            needsNextThink = true;
            timer.elapsed = Math.max(0, now - timer.startTime);

            const config = CHECKPOINT_CONFIGS[timer.systemId];
            if (config && config.timerLimit > 0 && timer.elapsed >= config.timerLimit) {
                FailCheckpointSystem(timer.systemId, config, timer.player, "timer limit");
                continue;
            }

            if (now >= timer.nextUpdate) {
                SetTimerText(timer.playerSlot, timer.elapsed);
                timer.nextUpdate = now + HUD_UPDATE_INTERVAL;
            }

            continue;
        }

        if (timer.hideAt > 0) {
            if (now >= timer.hideAt) {
                HideTimer(timer.playerSlot);
                timerByRun.delete(runKey);
            } else {
                needsNextThink = true;
            }
        }
    }

    if (needsNextThink) {
        Instance.SetNextThink(now);
    }
}

for (const [systemId, config] of Object.entries(CHECKPOINT_CONFIGS)) {
    for (let checkpoint = 1; checkpoint <= config.finalCheckpoint; checkpoint += 1) {
        Instance.OnScriptInput(`${config.inputPrefix}${checkpoint}`, ({ activator }) => {
            TouchCheckpoint(systemId, checkpoint, activator);
        });
    }

    if (config.failureResetInput) {
        Instance.OnScriptInput(config.failureResetInput, ({ activator }) => {
            FailureReset(systemId, activator);
        });
    }
}

Instance.OnPlayerDisconnect((event) => {
    const suffix = `:${event.playerSlot}`;

    for (const runKey of progressByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            progressByRun.delete(runKey);
        }
    }

    for (const runKey of timerByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            timerByRun.delete(runKey);
        }
    }
});

Instance.SetThink(TimerThink);
