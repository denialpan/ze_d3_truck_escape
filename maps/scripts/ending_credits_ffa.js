import { CSDamageFlags, CSDamageTypes, CSGearSlot, Instance } from "cs_script/point_script";

const INPUT_START = "start";
const CT_TEAM = 3;
const TARGET_MONEY = 67;
const GIVE_WEAPON = "weapon_usp_silencer";
const DEBUG_TRACE_LENGTH = 4096;
const DEBUG_TRACE_DURATION = 1.0;
const DEBUG_TRACE_COLOR = { r: 255, g: 0, b: 0 };
const USP_TRACE_DAMAGE = 20;
const DAMAGE_TEST_ENTITY_NAME = "damage_test";
const DAMAGE_TEST_DAMAGE = 100;

const trackedUsps = [];

function IsAliveCTPawn(pawn) {
    return pawn
        && pawn.IsValid()
        && pawn.IsAlive()
        && pawn.GetTeamNumber() === CT_TEAM;
}

function RemoveWeaponSlot(pawn, slot) {
    const weapon = pawn.FindWeaponBySlot(slot);
    if (weapon && weapon.IsValid()) {
        pawn.DestroyWeapon(weapon);
    }
}

function SetPlayerMoney(player, amount) {
    const currentMoney = player.GetMoneySpendableNow();
    player.AddMoneySpendableNow(amount - currentMoney);
}

function TrackGivenUsp(pawn) {
    const weapon = pawn.FindWeaponBySlot(CSGearSlot.PISTOL);
    if (!weapon || !weapon.IsValid()) {
        return;
    }

    trackedUsps.push(weapon);
}

function IsTrackedUsp(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return false;
    }

    for (const trackedUsp of trackedUsps) {
        if (trackedUsp && trackedUsp.IsValid() && trackedUsp === weapon) {
            return true;
        }
    }

    return weapon.GetClassName() === GIVE_WEAPON && IsOwnedByEligiblePlayer(weapon);
}

function IsOwnedByEligiblePlayer(weapon) {
    const owner = weapon.GetOwner();
    return IsAliveCTPawn(owner);
}

function GetForwardVector(angles) {
    const pitchRadians = (angles.pitch * Math.PI) / 180;
    const yawRadians = (angles.yaw * Math.PI) / 180;
    const horizontalScale = Math.cos(pitchRadians);

    return {
        x: Math.cos(yawRadians) * horizontalScale,
        y: Math.sin(yawRadians) * horizontalScale,
        z: -Math.sin(pitchRadians)
    };
}

function AddVectors(a, b) {
    return {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z
    };
}

function ScaleVector(vector, scale) {
    return {
        x: vector.x * scale,
        y: vector.y * scale,
        z: vector.z * scale
    };
}

function IsDifferentAliveCTPawn(pawn, shooter) {
    return IsAliveCTPawn(pawn) && pawn !== shooter;
}

function IsDamageTestEntity(entity) {
    return entity
        && entity.IsValid()
        && typeof entity.GetEntityName === "function"
        && entity.GetEntityName() === DAMAGE_TEST_ENTITY_NAME;
}

function DescribeEntity(entity) {
    if (!entity || !entity.IsValid()) {
        return "none";
    }

    const className = typeof entity.GetClassName === "function" ? entity.GetClassName() : "unknown_class";
    const entityName = typeof entity.GetEntityName === "function" ? entity.GetEntityName() : "unknown_name";
    return `${className}:${entityName}`;
}

function GetAliveCTPawns() {
    const pawns = [];

    for (const player of Instance.GetAllPlayerControllers()) {
        const pawn = player.GetPlayerPawn();
        if (IsAliveCTPawn(pawn)) {
            pawns.push(pawn);
        }
    }

    return pawns;
}

function DamagePassed(victim, beforeHealth, result) {
    if (!victim || !victim.IsValid()) {
        return true;
    }

    return result > 0 || victim.GetHealth() < beforeHealth || !victim.IsAlive();
}

function ApplyDamageWithFallback(victim, shooter, weapon, damage) {
    const beforeHealth = victim.GetHealth();
    const damageFlags = beforeHealth <= damage
        ? CSDamageFlags.IGNORE_ARMOR | CSDamageFlags.FORCE_DEATH
        : CSDamageFlags.IGNORE_ARMOR;

    const result = victim.TakeDamage({
        damage,
        damageTypes: CSDamageTypes.BULLET,
        damageFlags,
        inflictor: shooter,
        attacker: shooter,
        weapon
    });

    if (DamagePassed(victim, beforeHealth, result)) {
        return;
    }

    Instance.Msg("ending_credits_ffa.js: attributed damage did not pass, applying neutral fallback damage.");
    victim.TakeDamage({
        damage,
        damageTypes: CSDamageTypes.GENERIC,
        damageFlags: CSDamageFlags.IGNORE_ARMOR
    });
}

function KillRandomCTFromDamageTest(shooter, weapon) {
    const pawns = GetAliveCTPawns();
    if (pawns.length === 0) {
        return;
    }

    const pawn = pawns[Math.floor(Math.random() * pawns.length)];
    ApplyDamageWithFallback(pawn, shooter, weapon, DAMAGE_TEST_DAMAGE);
}

function ApplyScriptedUspDamage(victim, shooter, weapon) {
    ApplyDamageWithFallback(victim, shooter, weapon, USP_TRACE_DAMAGE);
}

function FireScriptedUspTrace(weapon) {
    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid()) {
        return;
    }

    const start = owner.GetEyePosition();
    const forward = GetForwardVector(owner.GetEyeAngles());
    const end = AddVectors(start, ScaleVector(forward, DEBUG_TRACE_LENGTH));
    const trace = Instance.TraceLine({
        start,
        end,
        ignoreEntity: owner,
        traceHitboxes: true
    });

    Instance.DebugLine({
        start,
        end: trace.didHit ? trace.end : end,
        duration: DEBUG_TRACE_DURATION,
        color: DEBUG_TRACE_COLOR
    });

    if (!trace.didHit) {
        Instance.Msg("ending_credits_ffa.js: scripted USP trace did not hit anything.");
        return;
    }

    Instance.Msg(`ending_credits_ffa.js: scripted USP trace hit ${DescribeEntity(trace.hitEntity)}.`);

    if (!trace.hitEntity) {
        return;
    }

    if (IsDamageTestEntity(trace.hitEntity)) {
        KillRandomCTFromDamageTest(owner, weapon);
        return;
    }

    if (!IsDifferentAliveCTPawn(trace.hitEntity, owner)) {
        return;
    }

    ApplyScriptedUspDamage(trace.hitEntity, owner, weapon);
}

function ApplyEndingCreditsFFA() {
    let affectedPlayers = 0;

    for (const player of Instance.GetAllPlayerControllers()) {
        const pawn = player.GetPlayerPawn();
        if (!IsAliveCTPawn(pawn)) {
            continue;
        }

        RemoveWeaponSlot(pawn, CSGearSlot.RIFLE);
        RemoveWeaponSlot(pawn, CSGearSlot.PISTOL);
        SetPlayerMoney(player, TARGET_MONEY);
        pawn.GiveNamedItem(GIVE_WEAPON, true);
        TrackGivenUsp(pawn);
        affectedPlayers++;
    }

    Instance.Msg(`ending_credits_ffa.js: applied FFA loadout to ${affectedPlayers} alive CT players.`);
}

Instance.OnScriptInput(INPUT_START, () => {
    ApplyEndingCreditsFFA();
});

Instance.OnGunFire((event) => {
    if (IsTrackedUsp(event.weapon)) {
        FireScriptedUspTrace(event.weapon);
    }
});
