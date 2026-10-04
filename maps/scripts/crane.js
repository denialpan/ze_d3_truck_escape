import { Entity, Instance } from "cs_script/point_script";

let craneLayout = null;
const CAMERA_ENTER_TIME = 1.5;
const CAMERA_EXIT_TIME = 1.0;
const CUSTOM_CAMERA_MODE_DISABLED = 0;
const CUSTOM_CAMERA_MODE_CONTROLLED = 1;
const CRANE_VIEW = {
    position: { x: 717, y: 732, z: 1017 },
    angles: { pitch: 38, yaw: -61, roll: 0 }
};
const CRANE_PULLEY_NAME = "crane_pulley";
const CRANE_HOOK_TRIGGER_NAME = "crane_pulley_hook";
const CARGO_CONTAINER_NAME = "cargo_container_1";
const CARGO_HOOK_NAME = "cargo_container_1_hook";
const CARGO_HOOK_DISTANCE = 32;
const HOOK_DEBUG_INTERVAL = 0.5;
const CRANE_COLLISION_STATIC_NAME = "crane_collision_static_1";
const CRANE_COLLISION_ARM_NAME = "crane_collision_arm_1";
const CRANE_COLLISION_CARGO_NAME = CARGO_CONTAINER_NAME;
const CRANE_COLLISION_WIRES_NAME = "crane_wires";
const COLLISION_BACKOFF_TIME = 0.15;
const craneCameras = new Map();
const activeCraneUsers = new Set();
const missingEntityReports = new Set();
let hookedCargo = null;
let nextHookDebugTime = 0;
let hookRangePrinted = false;
let collisionBackoffUntil = 0;
const currentMotion = {
    headSpeed: 0,
    trolley: null,
    pulley: null
};

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

function EaseOutExpo(t) {
    if (t >= 1) {
        return 1;
    }

    return 1 - Math.pow(2, -10 * t);
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

function ReportMissingEntity(name) {
    if (missingEntityReports.has(name)) {
        return;
    }

    missingEntityReports.add(name);
    Instance.Msg(`crane.js: missing entity named ${name}`);
}

function GetNamedEntity(name) {
    const entity = Instance.FindEntityByName(name);
    if (!entity || !entity.IsValid()) {
        ReportMissingEntity(name);
        return undefined;
    }

    return entity;
}

function Distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function GetPlayerCamera(pawn) {
    if (typeof pawn.GetCustomCamera === "function") {
        return pawn.GetCustomCamera();
    }

    return pawn.GetCamera();
}

function EnableControlledCamera(camera) {
    if (typeof camera.SetMode === "function") {
        camera.SetMode(CUSTOM_CAMERA_MODE_CONTROLLED);
        return;
    }

    camera.SetIsControllingAngles(true);
    camera.SetEnabled(true);
}

function DisableCamera(camera) {
    if (typeof camera.SetMode === "function") {
        camera.SetMode(CUSTOM_CAMERA_MODE_DISABLED);
        return;
    }

    camera.SetEnabled(false);
    camera.SetIsControllingAngles(false);
}

function UpdateCraneCameras() {
    const now = Instance.GetGameTime();

    for (const [playerSlot, state] of craneCameras) {
        if (!state.camera.IsValid()) {
            craneCameras.delete(playerSlot);
            continue;
        }

        const elapsed = now - state.transitionStartTime;
        const duration = state.transitionDuration;
        const t = EaseOutExpo(Math.min(elapsed / duration, 1));

        state.camera.Teleport({
            position: InterpolateVector(state.fromPosition, state.toPosition, t),
            angles: InterpolateAngles(state.fromAngles, state.toAngles, t)
        });

        if (elapsed >= duration) {
            if (state.mode === "exit") {
                DisableCamera(state.camera);
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
    const camera = GetPlayerCamera(pawn);

    camera.Teleport({ position: startPosition, angles: startAngles });
    EnableControlledCamera(camera);

    craneCameras.set(playerSlot, {
        camera,
        mode: "enter",
        startPosition,
        startAngles,
        fromPosition: startPosition,
        fromAngles: startAngles,
        toPosition: CRANE_VIEW.position,
        toAngles: CRANE_VIEW.angles,
        transitionDuration: CAMERA_ENTER_TIME,
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
    state.transitionDuration = CAMERA_EXIT_TIME;
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
    activeCraneUsers.add(playerSlot);
    Instance.EntFireAtName({ name: "crane_head_push", input: "Enable" });
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
    activeCraneUsers.delete(playerSlot);

    if (activeCraneUsers.size === 0) {
        StopAllCraneMotion();
        Instance.EntFireAtName({ name: "crane_head_push", input: "Disable" });
    }
}

function SetCraneHeadSpeed(speed) {
    Instance.EntFireAtName({ name: "crane_head", input: "SetSpeed", value: speed });
    currentMotion.headSpeed = speed;
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
    SetCraneMotionDirection(entityName, "open");
}

function CloseCraneEntity(entityName) {
    SetCraneEntitySpeed(entityName, 100);
    MoveCraneEntity(entityName, "Close");
    SetCraneMotionDirection(entityName, "close");
}

function StopCraneEntity(entityName) {
    SetCraneEntitySpeed(entityName, 0);
    SetCraneMotionDirection(entityName, null);
}

function StopAllCraneMotion() {
    SetCraneHeadSpeed(0);
    StopCraneEntity("crane_trolley");
    StopCraneEntity("crane_pulley");
}

function SetCraneMotionDirection(entityName, direction) {
    if (entityName === "crane_trolley") {
        currentMotion.trolley = direction;
    } else if (entityName === "crane_pulley") {
        currentMotion.pulley = direction;
    }
}

function ReverseCraneEntityBriefly(entityName, direction) {
    if (!direction) {
        return;
    }

    const reverseInput = direction === "open" ? "Close" : "Open";
    Instance.EntFireAtName({ name: entityName, input: "SetSpeed", value: 100 });
    Instance.EntFireAtName({ name: entityName, input: reverseInput });
    Instance.EntFireAtName({ name: entityName, input: "SetSpeed", value: 0, delay: COLLISION_BACKOFF_TIME });
}

function BackOffAndStopCraneMotion() {
    const headSpeed = currentMotion.headSpeed;
    const trolleyDirection = currentMotion.trolley;
    const pulleyDirection = currentMotion.pulley;

    if (headSpeed === 0 && !trolleyDirection && !pulleyDirection) {
        StopAllCraneMotion();
        return;
    }

    if (headSpeed !== 0) {
        Instance.EntFireAtName({ name: "crane_head", input: "SetSpeed", value: -headSpeed });
        Instance.EntFireAtName({ name: "crane_head", input: "SetSpeed", value: 0, delay: COLLISION_BACKOFF_TIME });
    }

    ReverseCraneEntityBriefly("crane_trolley", trolleyDirection);
    ReverseCraneEntityBriefly("crane_pulley", pulleyDirection);

    currentMotion.headSpeed = 0;
    currentMotion.trolley = null;
    currentMotion.pulley = null;
    collisionBackoffUntil = Instance.GetGameTime() + COLLISION_BACKOFF_TIME;
    Instance.Msg("crane.js: collision backoff applied, reversing active crane motion briefly before stop.");
}

function GetEntityName(entity) {
    if (!entity || !entity.IsValid() || typeof entity.GetEntityName !== "function") {
        return "";
    }

    return entity.GetEntityName();
}

function GetEntityClassName(entity) {
    if (!entity || !entity.IsValid() || typeof entity.GetClassName !== "function") {
        return "";
    }

    return entity.GetClassName();
}

function IsStaticCollisionEntityName(name) {
    return name === CRANE_COLLISION_STATIC_NAME;
}

function IsMovingCollisionEntityName(name) {
    return name === CRANE_COLLISION_ARM_NAME
        || name === CRANE_COLLISION_CARGO_NAME
        || name === CRANE_COLLISION_WIRES_NAME;
}

function HandleCraneCollision(caller, activator) {
    if (Instance.GetGameTime() < collisionBackoffUntil) {
        return;
    }

    const callerName = GetEntityName(caller);
    const activatorName = GetEntityName(activator);
    const callerClass = GetEntityClassName(caller);
    const activatorClass = GetEntityClassName(activator);
    const hitStatic = IsStaticCollisionEntityName(callerName) || IsStaticCollisionEntityName(activatorName);
    const hitMover = IsMovingCollisionEntityName(callerName) || IsMovingCollisionEntityName(activatorName);

    Instance.Msg(`crane.js: CraneCollision caller=${callerClass || "none"}:${callerName || "none"} activator=${activatorClass || "none"}:${activatorName || "none"}.`);

    if (!hitStatic || !hitMover) {
        Instance.Msg("crane.js: collision ignored because it is not mover vs static.");
        return;
    }

    if (callerName === CRANE_COLLISION_ARM_NAME || activatorName === CRANE_COLLISION_ARM_NAME) {
        Instance.Msg("crane.js: static collision detected with crane_collision_arm_1.");
        Instance.Msg("crane.js: crane_collision_arm_1 is inside crane_collision_static_1 via trigger touch.");
    }

    if (callerName === CRANE_COLLISION_CARGO_NAME || activatorName === CRANE_COLLISION_CARGO_NAME) {
        Instance.Msg("crane.js: static collision detected with cargo_container_1.");
    }

    if (callerName === CRANE_COLLISION_WIRES_NAME || activatorName === CRANE_COLLISION_WIRES_NAME) {
        Instance.Msg("crane.js: static collision detected with crane wires, stopping crane.");
    }

    BackOffAndStopCraneMotion();
    Instance.Msg("crane.js: mover touched static collision volume, backed off and stopped crane motion.");
}

function GetCargoHookDistance() {
    const hookTrigger = GetNamedEntity(CRANE_HOOK_TRIGGER_NAME);
    const cargoHook = GetNamedEntity(CARGO_HOOK_NAME);
    if (!hookTrigger || !cargoHook) {
        return undefined;
    }

    return Distance(hookTrigger.GetAbsOrigin(), cargoHook.GetAbsOrigin());
}

function DebugCargoHookDistance(now) {
    if (now < nextHookDebugTime) {
        return;
    }

    nextHookDebugTime = now + HOOK_DEBUG_INTERVAL;

    const distance = GetCargoHookDistance();
    if (distance === undefined) {
        return;
    }

    Instance.Msg(`crane.js: crane_pulley_hook is ${distance.toFixed(2)} units from cargo_container_1_hook.`);

    if (distance <= CARGO_HOOK_DISTANCE) {
        if (!hookRangePrinted) {
            Instance.Msg("crane.js: cargo hook is within hook range.");
            hookRangePrinted = true;
        }
        TryHookCargoContainer("polling");
    } else {
        hookRangePrinted = false;
    }
}

function TryHookCargoContainer(source) {
    if (hookedCargo && hookedCargo.IsValid()) {
        Instance.Msg(`crane.js: hook attempt from ${source}, cargo is already hooked.`);
        return;
    }

    Instance.Msg(`crane.js: processing cargo hook attempt from ${source}.`);

    const pulley = GetNamedEntity(CRANE_PULLEY_NAME);
    const hookTrigger = GetNamedEntity(CRANE_HOOK_TRIGGER_NAME);
    const cargo = GetNamedEntity(CARGO_CONTAINER_NAME);
    const cargoHook = GetNamedEntity(CARGO_HOOK_NAME);
    if (!pulley || !hookTrigger || !cargo || !cargoHook) {
        Instance.Msg("crane.js: hook attempt failed because a required entity is missing.");
        return;
    }

    const distance = Distance(hookTrigger.GetAbsOrigin(), cargoHook.GetAbsOrigin());
    if (distance > CARGO_HOOK_DISTANCE) {
        Instance.Msg(`crane.js: cargo hook is ${distance.toFixed(2)} units away, not hooking.`);
        return;
    }

    cargo.SetParent(pulley);
    hookedCargo = cargo;

    if (cargo.GetParent() === pulley) {
        Instance.Msg("crane.js: cargo_container_1 successfully parented to crane_pulley.");
    } else {
        Instance.Msg("crane.js: SetParent was called, but cargo_container_1 parent did not verify as crane_pulley.");
    }
}

function UpdateCrane() {
    const now = Instance.GetGameTime();

    UpdateCraneCameras();
    DebugCargoHookDistance(now);

    if (craneCameras.size > 0) {
        Instance.SetNextThink(Instance.GetGameTime());
    } else {
        Instance.SetNextThink(now + HOOK_DEBUG_INTERVAL);
    }
}

Instance.OnScriptInput("ShowCrane", ({ activator, caller }) => {
    const player = GetPlayerController(activator) || GetPlayerController(caller);
    if (!player) {
        Instance.Msg("crane.js: ShowCrane needs a player activator or caller");
        return;
    }

    ShowCraneControls(player);
});

Instance.OnScriptInput("CraneHookTouch", () => {
    TryHookCargoContainer("RunScriptInput CraneHookTouch");
});

Instance.OnScriptInput("CraneCollision", ({ activator, caller }) => {
    HandleCraneCollision(caller, activator);
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

Instance.SetThink(UpdateCrane);
Instance.SetNextThink(Instance.GetGameTime() + HOOK_DEBUG_INTERVAL);

Instance.OnPlayerDisconnect((event) => {
    craneCameras.delete(event.playerSlot);
    activeCraneUsers.delete(event.playerSlot);

    if (activeCraneUsers.size === 0) {
        StopAllCraneMotion();
        Instance.EntFireAtName({ name: "crane_head_push", input: "Disable" });
    }
});
