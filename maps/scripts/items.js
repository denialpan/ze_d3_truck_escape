import { Instance } from "cs_script/point_script";

const SNIPER_ENTITY_NAME = "sniper";
const SNIPER_CLASS_NAME = "weapon_awp";
const LASER_ENTITY_NAME = "sniper_laser";
const LASER_UPDATE_INTERVAL = 0.005;

let sniperWeapons = [];
let sniperHolders = new Map();
let sniperLaser = undefined;
let sniperLaserDefaultTransform = undefined;
let sniperLaserAtDefault = true;
let debugActiveWeapon = undefined;
let debugActiveDescription = "";

function RefreshSnipers() {
    sniperWeapons = Instance.FindEntitiesByName(SNIPER_ENTITY_NAME).filter((entity) => {
        return entity
            && entity.IsValid()
            && typeof entity.GetClassName === "function"
            && entity.GetClassName() === SNIPER_CLASS_NAME;
    });

    Instance.Msg(`items.js: found ${sniperWeapons.length} named sniper AWP entities.`);
    RefreshSniperLaser();
    RefreshSniperHolders();
}

function RefreshSniperLaser() {
    sniperLaser = Instance.FindEntitiesByName(LASER_ENTITY_NAME)[0];

    if (!sniperLaser || !sniperLaser.IsValid()) {
        Instance.Msg(`items.js: could not find prop_dynamic named ${LASER_ENTITY_NAME}.`);
        sniperLaserDefaultTransform = undefined;
        sniperLaserAtDefault = true;
        return;
    }

    sniperLaserDefaultTransform = {
        position: sniperLaser.GetAbsOrigin(),
        angles: sniperLaser.GetAbsAngles()
    };
    sniperLaserAtDefault = true;
}

function IsTrackedSniper(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return false;
    }

    for (const sniper of sniperWeapons) {
        if (sniper && sniper.IsValid() && sniper === weapon) {
            return true;
        }
    }

    return IsNamedSniperWeapon(weapon);
}

function IsNamedSniperWeapon(weapon) {
    return weapon
        && weapon.IsValid()
        && typeof weapon.GetClassName === "function"
        && typeof weapon.GetEntityName === "function"
        && weapon.GetClassName() === SNIPER_CLASS_NAME
        && weapon.GetEntityName() === SNIPER_ENTITY_NAME;
}

function DescribeWeapon(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return "none";
    }

    const className = typeof weapon.GetClassName === "function" ? weapon.GetClassName() : "unknown_class";
    const entityName = typeof weapon.GetEntityName === "function" ? weapon.GetEntityName() : "unknown_name";
    return `${className}:${entityName}`;
}

function StartActiveCheck() {
    if (sniperHolders.size > 0) {
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

function RefreshSniperHolders() {
    sniperHolders = new Map();

    for (const sniper of sniperWeapons) {
        if (!sniper || !sniper.IsValid()) {
            continue;
        }

        const owner = sniper.GetOwner();
        if (owner && owner.IsValid()) {
            sniperHolders.set(sniper, owner);
        }
    }
}

function TrackSniperPickup(weapon) {
    if (!IsTrackedSniper(weapon)) {
        return;
    }

    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid()) {
        return;
    }

    sniperHolders.set(weapon, owner);
    Instance.Msg("items.js: tracked sniper was picked up.");
    UpdateLaserForHolder(weapon, owner);
    StartActiveCheck();
}

function TrackSniperDrop(weapon) {
    if (!IsTrackedSniper(weapon)) {
        return;
    }

    sniperHolders.delete(weapon);
    Instance.Msg("items.js: tracked sniper was dropped.");
    ResetLaserToDefault();
}

function ResetLaserToDefault() {
    if (sniperLaserAtDefault) {
        return;
    }

    if (!sniperLaser || !sniperLaser.IsValid()) {
        RefreshSniperLaser();
    }

    if (!sniperLaser || !sniperLaser.IsValid() || !sniperLaserDefaultTransform) {
        return;
    }

    sniperLaser.SetParent(undefined);
    sniperLaser.Teleport(sniperLaserDefaultTransform);
    sniperLaserAtDefault = true;
    Instance.Msg("items.js: returned sniper_laser to its default map position.");
}

function UpdateLaserForHolder(weapon, pawn) {
    if (!sniperLaser || !sniperLaser.IsValid()) {
        RefreshSniperLaser();
    }

    if (!sniperLaser || !sniperLaser.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
        return;
    }

    const activeWeapon = pawn.GetActiveWeapon();
    if (!IsTrackedSniper(activeWeapon)) {
        const description = DescribeWeapon(activeWeapon);
        if (debugActiveDescription !== description) {
            debugActiveDescription = description;
        }
        ResetLaserToDefault();
        return;
    }

    if (debugActiveWeapon !== activeWeapon) {
        Instance.Msg("items.js: tracked sniper is held and active.");
        debugActiveWeapon = activeWeapon;
    }

    const position = pawn.GetEyePosition();
    const angles = pawn.GetEyeAngles();

    sniperLaser.SetParent(undefined);
    sniperLaser.Teleport({
        position,
        angles
    });
    sniperLaserAtDefault = false;
}

function Think() {
    if (sniperHolders.size === 0) {
        return;
    }

    Instance.SetNextThink(Instance.GetGameTime() + LASER_UPDATE_INTERVAL);

    for (const [weapon, pawn] of sniperHolders) {
        if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            sniperHolders.delete(weapon);
            continue;
        }

        if (IsTrackedSniper(pawn.GetActiveWeapon())) {
            UpdateLaserForHolder(weapon, pawn);
            return;
        }
    }

    ResetLaserToDefault();
}

function UpdateLaserForExistingHolder() {
    for (const [weapon, pawn] of sniperHolders) {
        if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            sniperHolders.delete(weapon);
            continue;
        }

        if (pawn.GetActiveWeapon() === weapon) {
            UpdateLaserForHolder(weapon, pawn);
            return;
        }
    }
}

Instance.OnWeaponPickup((event) => {
    TrackSniperPickup(event.weapon);
});

Instance.OnWeaponDrop((event) => {
    TrackSniperDrop(event.weapon);
});

Instance.OnRoundStart(() => {
    RefreshSnipers();
    UpdateLaserForExistingHolder();
    StartActiveCheck();
});

RefreshSnipers();
Instance.SetThink(Think);
UpdateLaserForExistingHolder();
StartActiveCheck();
