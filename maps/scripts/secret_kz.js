import { Entity, Instance } from "cs_script/point_script";

const FINAL_CHECKPOINT = 8;
const SUCCESS_RELAY = "relay_secret_kz_success";
const FAILURE_RELAY = "relay_secret_kz_failure";
const HUD_NAME = "hud_secret_kz";
const HUD_PANEL_ID = "secret_kz_timer";
const HUD_UPDATE_INTERVAL = 1 / 100;
const FAILURE_HOLD_TIME = 2;
const SUCCESS_HOLD_TIME = 10;

const progressBySlot = new Map();
const timerBySlot = new Map();
let kzHud = null;

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

function GetKzHud() {
    if (!(kzHud instanceof Entity) || !kzHud.IsValid()) {
        kzHud = Instance.FindEntitiesByName(HUD_NAME)[0];
    }
    return kzHud;
}

function FormatTime(seconds) {
    return Math.max(0, seconds).toFixed(3);
}

function SetTimerText(playerSlot, seconds) {
    const layout = GetKzHud();
    if (!layout) {
        return;
    }

    layout.SetDialogVariableStringForPlayer(playerSlot, "timer_text", "kz_time", FormatTime(seconds));
}

function ShowTimer(playerSlot) {
    const layout = GetKzHud();
    if (!layout) {
        Instance.Msg(`secret_kz.js: missing custom_hud_layout named ${HUD_NAME}`);
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", false);
}

function HideTimer(playerSlot) {
    const layout = GetKzHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", true);
}

function SetTimerState(playerSlot, stateClass) {
    const layout = GetKzHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerFailure", stateClass === "TimerFailure");
    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerSuccess", stateClass === "TimerSuccess");
}

function StartTimer(playerSlot) {
    const now = Instance.GetGameTime();
    timerBySlot.set(playerSlot, {
        startTime: now,
        elapsed: 0,
        running: true,
        nextUpdate: 0,
        hideAt: 0
    });
    SetTimerState(playerSlot, undefined);
    SetTimerText(playerSlot, 0);
    ShowTimer(playerSlot);
    Instance.SetNextThink(now);
}

function StopTimer(playerSlot) {
    const timer = timerBySlot.get(playerSlot);
    if (!timer) {
        return 0;
    }

    timer.elapsed = Math.max(0, Instance.GetGameTime() - timer.startTime);
    timer.running = false;
    SetTimerText(playerSlot, timer.elapsed);
    return timer.elapsed;
}

function ResetTimer(playerSlot) {
    timerBySlot.delete(playerSlot);
    SetTimerState(playerSlot, undefined);
    SetTimerText(playerSlot, 0);
    HideTimer(playerSlot);
}

function HoldTimer(playerSlot, stateClass, holdTime) {
    const now = Instance.GetGameTime();
    const timer = timerBySlot.get(playerSlot) || {
        startTime: now,
        elapsed: 0,
        running: false,
        nextUpdate: 0,
        hideAt: 0
    };

    timer.running = false;
    timer.hideAt = now + holdTime;
    timerBySlot.set(playerSlot, timer);

    SetTimerText(playerSlot, timer.elapsed);
    SetTimerState(playerSlot, stateClass);
    ShowTimer(playerSlot);
    Instance.SetNextThink(now);
}

function ResetPlayerProgress(playerSlot) {
    progressBySlot.set(playerSlot, 0);
}

function TouchCheckpoint(checkpointNumber, activator) {
    const player = GetPlayerController(activator);
    if (!player) {
        Instance.Msg(`secret_kz.js: checkpoint_${checkpointNumber} needs a player activator`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const currentCheckpoint = progressBySlot.get(playerSlot) || 0;
    const expectedCheckpoint = currentCheckpoint + 1;

    if (checkpointNumber !== expectedCheckpoint) {
        ResetPlayerProgress(playerSlot);
        StopTimer(playerSlot);
        HoldTimer(playerSlot, "TimerFailure", FAILURE_HOLD_TIME);
        Instance.Msg(`secret_kz.js: player ${playerSlot} failed at checkpoint_${checkpointNumber}`);
        FireRelay(FAILURE_RELAY, player);
        return;
    }

    progressBySlot.set(playerSlot, checkpointNumber);
    Instance.Msg(`secret_kz.js: player ${playerSlot} reached checkpoint_${checkpointNumber}`);

    if (checkpointNumber === 1) {
        StartTimer(playerSlot);
    }

    if (checkpointNumber === FINAL_CHECKPOINT) {
        const elapsed = StopTimer(playerSlot);
        HoldTimer(playerSlot, "TimerSuccess", SUCCESS_HOLD_TIME);
        ResetPlayerProgress(playerSlot);
        Instance.Msg(`secret_kz.js: player ${playerSlot} completed in ${FormatTime(elapsed)}`);
        FireRelay(SUCCESS_RELAY, player);
    }
}

function TimerThink() {
    const now = Instance.GetGameTime();
    let needsNextThink = false;

    for (const [playerSlot, timer] of timerBySlot) {
        if (timer.running) {
            needsNextThink = true;
            timer.elapsed = Math.max(0, now - timer.startTime);

            if (now >= timer.nextUpdate) {
                SetTimerText(playerSlot, timer.elapsed);
                timer.nextUpdate = now + HUD_UPDATE_INTERVAL;
            }

            continue;
        }

        if (timer.hideAt > 0) {
            if (now >= timer.hideAt) {
                HideTimer(playerSlot);
                timerBySlot.delete(playerSlot);
            } else {
                needsNextThink = true;
            }
        }
    }

    if (needsNextThink) {
        Instance.SetNextThink(now);
    }
}

for (let checkpoint = 1; checkpoint <= FINAL_CHECKPOINT; checkpoint += 1) {
    Instance.OnScriptInput(`checkpoint_${checkpoint}`, ({ activator }) => {
        TouchCheckpoint(checkpoint, activator);
    });
}

Instance.OnPlayerDisconnect((event) => {
    progressBySlot.delete(event.playerSlot);
    timerBySlot.delete(event.playerSlot);
});

Instance.SetThink(TimerThink);
