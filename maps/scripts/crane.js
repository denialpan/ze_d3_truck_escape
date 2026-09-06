import { Entity, Instance } from "cs_script/point_script";

let craneLayout = null;

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

function ShowCraneControls(playerSlot) {
    const layout = GetCraneLayout();
    if (!layout) {
        Instance.Msg("crane.js: missing custom_hud_layout named hud_crane");
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, "crane_panel", "Dismissed", false);
    layout.SetInputCaptureEnabled(playerSlot, true);
}

function HideCraneControls(playerSlot) {
    const layout = GetCraneLayout();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, "crane_panel", "Dismissed", true);
    layout.SetInputCaptureEnabled(playerSlot, false);
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

    ShowCraneControls(player.GetPlayerSlot());
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
