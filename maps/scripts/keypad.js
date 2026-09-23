import { Instance } from "cs_script/point_script";

const KEYPAD_CONFIGS = {
	
    "keypad_original": {
        code: "241536",
        digits: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        buttonPrefix: "keypad_original_",
        pressRelay: "relay_keypad_original_button_press",
        successRelay: "relay_keypad_original_button_correct",
        failureRelay: "relay_keypad_original_button_incorrect"
    },
	
	"keypad_floor_2_garage": {
        code: "67676767",
        digits: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        buttonPrefix: "keypad_floor_2_garage_",
        pressRelay: "relay_keypad_floor_2_garage_button_press",
        successRelay: "relay_keypad_floor_2_garage_button_correct",
        failureRelay: "relay_keypad_floor_2_garage_button_incorrect"
    }
	
};

const keypads = new Map();

function FireRelay(name) {
    if (!name) {
        return;
    }

    Instance.EntFireAtName({ name, input: "Trigger" });
}

function SubmitKeypad(keypad) {
    FireRelay(keypad.successRelay);
    keypad.entry = "";
}

function FailKeypad(keypad) {
    FireRelay(keypad.failureRelay);
    keypad.entry = "";
}

function PressDigit(keypadId, digit) {
    const keypad = keypads.get(keypadId);
    if (!keypad) {
        Instance.Msg(`entity_keypad.js: missing keypad "${keypadId}"`);
        return;
    }

    if (keypad.entry.length >= keypad.code.length) {
        keypad.entry = "";
    }

    FireRelay(keypad.pressRelay);

    const expectedDigit = keypad.code[keypad.entry.length];
    if (digit !== expectedDigit) {
        FailKeypad(keypad);
        return;
    }

    keypad.entry += digit;

    if (keypad.entry.length >= keypad.code.length) {
        SubmitKeypad(keypad);
    }
}

function SetupKeypads() {
    Instance.Msg("entity_keypad.js: initializing keypads");

    for (const [id, config] of Object.entries(KEYPAD_CONFIGS)) {
        keypads.set(id, {
            id,
            entry: "",
            code: config.code,
            pressRelay: config.pressRelay,
            successRelay: config.successRelay,
            failureRelay: config.failureRelay
        });
    }
}

for (const [id, config] of Object.entries(KEYPAD_CONFIGS)) {
    const digits = config.digits || Array.from(new Set(config.code.split("")));

    for (const digit of digits) {
        Instance.OnScriptInput(`${id}_${digit}`, () => PressDigit(id, digit));
    }
}

Instance.OnActivate(SetupKeypads);
