import { Entity, Instance } from "cs_script/point_script";

let craneLayout = null;
const CAMERA_TRANSITION_TIME = 0.5;
const CRANE_VIEW = {
    position: { x: 717, y: 732, z: 1017 },
    angles: { pitch: 38, yaw: -61, roll: 0 }
};
const craneCameras = new Map();

function GetCraneLayout() {
    if (!(craneLayout instanceof Entity) || !craneLayout.IsValid()) {
        craneLayout = Instance.FindEntitiesByName("hud_crane")[0];
    }
    return craneLayout;
}

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

function GetPlayerPawn(player) {
    if (!player || typeof player.GetPlayerPawn !== "function") {
        return undefined;
    }

    const pawn = player.GetPlayerPawn();
    if (!pawn || !pawn.IsValid()) {
        return undefined;
    }

    return pawn;
}

function Lerp(a, b, t) {
    return a + (b - a) * t;
}

function LerpAngle(a, b, t) {
    let delta = (b - a) % 360;
    if (delta > 180) {
        delta -= 360;
    } else if (delta < -180) {
        delta += 360;
    }

    return a + delta * t;
}

function SmoothStep(t) {
    return t * t * (3 - 2 * t);
}

function InterpolateVector(a, b, t) {
    return {
        x: Lerp(a.x, b.x, t),
        y: Lerp(a.y, b.y, t),
        z: Lerp(a.z, b.z, t)
    };
}

function InterpolateAngles(a, b, t) {
    return {
        pitch: LerpAngle(a.pitch, b.pitch, t),
        yaw: LerpAngle(a.yaw, b.yaw, t),
        roll: LerpAngle(a.roll, b.roll, t)
    };
}

function UpdateCraneCameras() {
    const now = Instance.GetGameTime();

    for (const [playerSlot, state] of craneCameras) {
        if (!state.camera.IsValid()) {
            craneCameras.delete(playerSlot);
            continue;
        }

        const elapsed = now - state.transitionStartTime;
        const t = SmoothStep(Math.min(elapsed / CAMERA_TRANSITION_TIME, 1));

        state.camera.Teleport({
            position: InterpolateVector(state.fromPosition, state.toPosition, t),
            angles: InterpolateAngles(state.fromAngles, state.toAngles, t)
        });

        if (elapsed >= CAMERA_TRANSITION_TIME) {
            if (state.mode === "exit") {
                state.camera.SetEnabled(false);
                state.camera.SetIsControllingAngles(false);
                craneCameras.delete(playerSlot);
            } else {
                state.fromPosition = state.toPosition;
                state.fromAngles = state.toAngles;
            }
        }
    }

    if (craneCameras.size > 0) {
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

function StartCraneCamera(player) {
    const pawn = GetPlayerPawn(player);
    if (!pawn) {
        Instance.Msg("crane.js: ShowCrane needs an active player pawn for camera control");
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const startPosition = pawn.GetEyePosition();
    const startAngles = pawn.GetEyeAngles();
    const camera = pawn.GetCamera();

    camera.Teleport({ position: startPosition, angles: startAngles });
    camera.SetIsControllingAngles(true);
    camera.SetEnabled(true);

    craneCameras.set(playerSlot, {
        camera,
        mode: "enter",
        startPosition,
        startAngles,
        fromPosition: startPosition,
        fromAngles: startAngles,
        toPosition: CRANE_VIEW.position,
        toAngles: CRANE_VIEW.angles,
        transitionStartTime: Instance.GetGameTime()
    });
    Instance.SetNextThink(Instance.GetGameTime());
}

function ExitCraneCamera(playerSlot) {
    const state = craneCameras.get(playerSlot);
    if (!state) {
        return;
    }

    state.mode = "exit";
    state.fromPosition = state.camera.GetAbsOrigin();
    state.fromAngles = state.camera.GetAbsAngles();
    state.toPosition = state.startPosition;
    state.toAngles = state.startAngles;
    state.transitionStartTime = Instance.GetGameTime();
    Instance.SetNextThink(Instance.GetGameTime());
}

function ShowCraneControls(player) {
    const playerSlot = player.GetPlayerSlot();
    const layout = GetCraneLayout();
    if (!layout) {
        Instance.Msg("crane.js: missing custom_hud_layout named hud_crane");
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, "crane_panel", "Dismissed", false);
    layout.SetInputCaptureEnabled(playerSlot, true);
    StartCraneCamera(player);
}

function HideCraneControls(playerSlot) {
    const layout = GetCraneLayout();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, "crane_panel", "Dismissed", true);
    layout.SetInputCaptureEnabled(playerSlot, false);
    ExitCraneCamera(playerSlot);
}

function SetCraneHeadSpeed(speed) {
    Instance.EntFireAtName({ name: "crane_head", input: "SetSpeed", value: speed });
}

function MoveCraneEntity(entityName, inputName) {
    Instance.EntFireAtName({ name: entityName, input: inputName });
}

function SetCraneEntitySpeed(entityName, speed) {
    Instance.EntFireAtName({ name: entityName, input: "SetSpeed", value: speed });
}

function OpenCraneEntity(entityName) {
    SetCraneEntitySpeed(entityName, 100);
    MoveCraneEntity(entityName, "Open");
}

function CloseCraneEntity(entityName) {
    SetCraneEntitySpeed(entityName, 100);
    MoveCraneEntity(entityName, "Close");
}

function StopCraneEntity(entityName) {
    SetCraneEntitySpeed(entityName, 0);
}

function StopAllCraneMotion() {
    SetCraneHeadSpeed(0);
    StopCraneEntity("crane_trolley");
    StopCraneEntity("crane_pulley");
}

Instance.OnScriptInput("ShowCrane", ({ activator, caller }) => {
    const player = GetPlayerController(activator) || GetPlayerController(caller);
    if (!player) {
        Instance.Msg("crane.js: ShowCrane needs a player activator or caller");
        return;
    }

    ShowCraneControls(player);
});

Instance.OnCustomHudClicked((event) => {
    if (event.layout !== GetCraneLayout()) {
        return;
    }

    switch (event.buttonId) {
        case "crane_rotate_ccw":
            SetCraneHeadSpeed(0.2);
            break;
        case "crane_rotate_cw":
            SetCraneHeadSpeed(-0.2);
            break;
        case "crane_trolley_forward":
            OpenCraneEntity("crane_trolley");
            break;
        case "crane_trolley_backward":
            CloseCraneEntity("crane_trolley");
            break;
        case "crane_pulley_up":
            OpenCraneEntity("crane_pulley");
            break;
        case "crane_pulley_down":
            CloseCraneEntity("crane_pulley");
            break;
        case "crane_stop":
            StopAllCraneMotion();
            break;
        case "crane_cancel":
            HideCraneControls(event.player.GetPlayerSlot());
            break;
    }
});

Instance.SetThink(UpdateCraneCameras);

Instance.OnPlayerDisconnect((event) => {
    craneCameras.delete(event.playerSlot);
});
