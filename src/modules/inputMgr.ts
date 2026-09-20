import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
    emitKeypressEvents,
    type Key,
} from "node:readline";

export type KeyAction = "press" | "repeat" | "release";

export type KeyboardProtocol = "unknown" | "legacy" | "kitty";

export type PressedKey = {
    name: string;
    action: KeyAction;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
};

export type MouseInput = {
    x: number;
    y: number;
    button: "left" | "middle" | "right" | "none" | "wheelUp" | "wheelDown";
    action: "press" | "release" | "move" | "drag" | "scroll";
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
};

type InputManagerEvents = {
    keypress: [key: PressedKey];
    mouse: [mouse: MouseInput];
    capabilitieschange: [];
};

const KITTY_KEYBOARD_FLAGS = 2 | 8;

// Legacy terminals do not send key-up events.
// A release is synthesized after input for the same key stops arriving.
const LEGACY_INITIAL_RELEASE_DELAY_MS = 650;
const LEGACY_MIN_REPEAT_RELEASE_DELAY_MS = 60;
const LEGACY_MAX_REPEAT_RELEASE_DELAY_MS = 180;

type LegacyHeldKey = {
    key: Omit<PressedKey, "action">;
    timer: ReturnType<typeof setTimeout> | null;
    lastInputAt: number;
};

type KittyDetectionState =
    | "idle"
    | "probing"
    | "verifying";

const KITTY_FUNCTION_KEYS: Record<string, string> = {
    A: "up",
    B: "down",
    C: "right",
    D: "left",
    E: "clear",
    F: "end",
    H: "home",
    P: "f1",
    Q: "f2",
    S: "f4",
};

const KITTY_TILDE_KEYS: Record<number, string> = {
    1: "home",
    2: "insert",
    3: "delete",
    4: "end",
    5: "pageup",
    6: "pagedown",
    7: "home",
    8: "end",
    11: "f1",
    12: "f2",
    13: "f3",
    14: "f4",
    15: "f5",
    17: "f6",
    18: "f7",
    19: "f8",
    20: "f9",
    21: "f10",
    23: "f11",
    24: "f12",
    29: "menu",
};

const KITTY_PRIVATE_KEYS: Record<number, string> = {
    57358: "capslock",
    57359: "scrolllock",
    57360: "numlock",
    57361: "printscreen",
    57362: "pause",
    57363: "menu",

    57428: "mediaplay",
    57429: "mediapause",
    57430: "mediaplaypause",
    57431: "mediareverse",
    57432: "mediastop",
    57433: "mediafastforward",
    57434: "mediarewind",
    57435: "medianext",
    57436: "mediaprevious",
    57437: "mediarecord",
    57438: "volumedown",
    57439: "volumeup",
    57440: "volumemute",

    57441: "shift",
    57442: "ctrl",
    57443: "alt",
    57444: "super",
    57445: "hyper",
    57446: "meta",
    57447: "shift",
    57448: "ctrl",
    57449: "alt",
    57450: "super",
    57451: "hyper",
    57452: "meta",
};

class InputManager extends EventEmitter<InputManagerEvents> {
    readonly #keyboardStream = new PassThrough();

    #buffer = "";
    #initialized = false;

    #keyboardProtocol: KeyboardProtocol = "unknown";
    #kittyDetectionState: KittyDetectionState = "idle";
    #kittyKeyboardEnabled = false;

    readonly #legacyHeldKeys = new Map<string, LegacyHeldKey>();

    constructor() {
        super();

        emitKeypressEvents(this.#keyboardStream);

        this.#keyboardStream.on(
            "keypress",
            (str: string | undefined, key: Key) => {
                this.#emitLegacyKey({
                    name: key.name ?? str ?? "",
                    shift: key.shift ?? false,
                    ctrl: key.ctrl ?? false,
                    alt: key.meta ?? false,
                    meta: false,
                });
            },
        );
    }

    get keyboardProtocol(): KeyboardProtocol {
        return this.#keyboardProtocol;
    }

    /**
     * True only when the terminal itself supports the Kitty keyboard protocol.
     * Legacy terminals still receive synthesized release events.
     */
    get isKittySupported(): boolean {
        return this.#keyboardProtocol === "kitty";
    }

    /**
     * InputManager always exposes release events.
     * Kitty terminals provide native releases; legacy terminals use a timer fallback.
     */
    get supportsKeyRelease(): boolean {
        return true;
    }

    emitMouse(mouse: MouseInput): void {
        this.emit("mouse", mouse);
    }

    initialize(): void {
        if (this.#initialized) return;

        this.#initialized = true;

        process.stdin.setRawMode?.(true);
        process.stdin.resume();

        process.stdin.on("data", this.#handleData);

        this.#keyboardProtocol = "unknown";
        this.#kittyDetectionState = "probing";
        this.#kittyKeyboardEnabled = false;
        this.#clearLegacyHeldKeys(false);

        process.stdout.write(
            /*
             * Kitty keyboard protocol 지원 여부 확인.
             *
             * CSI ? u  : 현재 progressive enhancement flags 질의
             * CSI c    : Primary Device Attributes 질의
             *
             * Kitty 사양에서는 두 요청을 연속으로 보내고,
             * DA 응답보다 먼저 CSI ? flags u 응답이 오는지로
             * 프로토콜 지원 여부를 확인하도록 권장한다.
             */
            "\x1b[?u" +
            "\x1b[c" +

            // SGR mouse + 모든 mouse movement
            "\x1b[?1003h" +
            "\x1b[?1006h",
        );
    }

    restore(): void {
        if (!this.#initialized) return;

        process.stdin.off("data", this.#handleData);

        process.stdout.write(
            // 우리가 push한 Kitty keyboard mode만 pop.
            (this.#kittyKeyboardEnabled
                ? "\x1b[<u"
                : "") +

            // Mouse mode 복구
            "\x1b[?1003l" +
            "\x1b[?1006l",
        );

        process.stdin.setRawMode?.(false);

        const capabilityChanged =
            this.#keyboardProtocol !== "unknown";

        // Do not leave consumers with keys stuck in the pressed state.
        this.#clearLegacyHeldKeys(true);

        this.#buffer = "";
        this.#initialized = false;

        this.#keyboardProtocol = "unknown";
        this.#kittyDetectionState = "idle";
        this.#kittyKeyboardEnabled = false;

        if (capabilityChanged) {
            this.emit("capabilitieschange");
        }
    }

    readonly #handleData = (data: Buffer): void => {
        this.#buffer += data.toString("utf8");

        this.#processBuffer();
    };

    #processBuffer(): void {
        while (this.#buffer.length > 0) {
            // ESC로 시작하지 않는 평범한 입력은 기존 readline parser로 전달.
            if (!this.#buffer.startsWith("\x1b")) {
                const escapeIndex = this.#buffer.indexOf("\x1b");
                const keyboardLength = escapeIndex === -1
                    ? this.#buffer.length
                    : escapeIndex;

                this.#writeKeyboard(
                    this.#buffer.slice(0, keyboardLength),
                );

                this.#buffer =
                    this.#buffer.slice(keyboardLength);

                continue;
            }

            /*
             * Kitty keyboard protocol progressive enhancement 응답:
             *
             * ESC [ ? flags u
             */
            const kittyCapabilityMatch =
                /^\x1b\[\?(\d+)u/.exec(
                    this.#buffer,
                );

            if (kittyCapabilityMatch) {
                const flags =
                    Number(kittyCapabilityMatch[1]);

                this.#buffer =
                    this.#buffer.slice(
                        kittyCapabilityMatch[0].length,
                    );

                this.#handleKittyCapabilityResponse(flags);

                continue;
            }

            /*
             * Primary Device Attributes 응답.
             *
             * Kitty probe 중 이 응답이 먼저 왔다면
             * Kitty keyboard protocol 미지원으로 판단한다.
             */
            const primaryDeviceAttributesMatch =
                /^\x1b\[\??[0-9;]*c/.exec(
                    this.#buffer,
                );

            if (primaryDeviceAttributesMatch) {
                this.#buffer =
                    this.#buffer.slice(
                        primaryDeviceAttributesMatch[0].length,
                    );

                if (
                    this.#kittyDetectionState === "probing"
                ) {
                    this.#setKeyboardCapabilities(
                        "legacy",
                        false,
                    );

                    this.#kittyDetectionState = "idle";
                }

                continue;
            }

            /*
             * SGR mouse:
             *
             * ESC [ < Cb ; Cx ; Cy M
             * ESC [ < Cb ; Cx ; Cy m
             */
            const mouseMatch =
                /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(
                    this.#buffer,
                );

            if (mouseMatch) {
                this.#emitMouse(
                    Number(mouseMatch[1]),
                    Number(mouseMatch[2]),
                    Number(mouseMatch[3]),
                    mouseMatch[4] === "M",
                );

                this.#buffer =
                    this.#buffer.slice(mouseMatch[0].length);

                continue;
            }

            // 아직 SGR mouse sequence가 전부 도착하지 않음.
            if (/^\x1b\[<[0-9;]*$/.test(this.#buffer)) {
                return;
            }

            /*
             * Kitty CSI-u:
             *
             * ESC [ key ; modifiers:event u
             *
             * 예:
             * ESC[97;1:1u -> a press
             * ESC[97;1:2u -> a repeat
             * ESC[97;1:3u -> a release
             */
            const kittyKeyMatch =
                /^\x1b\[(\d+)(?::[\d:]*)?(?:;(\d+)(?::([123]))?)?(?:;[\d:]*)?u/.exec(
                    this.#buffer,
                );

            if (kittyKeyMatch) {
                const code = Number(kittyKeyMatch[1]);
                const modifierValue = kittyKeyMatch[2]
                    ? Number(kittyKeyMatch[2])
                    : 1;
                const eventValue = kittyKeyMatch[3]
                    ? Number(kittyKeyMatch[3])
                    : 1;

                this.#emitKittyKey(
                    this.#getKittyKeyName(code),
                    modifierValue,
                    eventValue,
                );

                this.#buffer =
                    this.#buffer.slice(kittyKeyMatch[0].length);

                continue;
            }

            /*
             * Kitty functional keys:
             *
             * ESC [ 1 ; modifiers:event A
             * ESC [ 1 ; modifiers:event B
             * ...
             *
             * Arrow/Home/End/F1~F4 등.
             */
            const kittyFunctionMatch =
                /^\x1b\[1(?:;(\d+)(?::([123]))?)?([ABCDEFHPQS])/.exec(
                    this.#buffer,
                );

            if (kittyFunctionMatch) {
                const modifierValue = kittyFunctionMatch[1]
                    ? Number(kittyFunctionMatch[1])
                    : 1;
                const eventValue = kittyFunctionMatch[2]
                    ? Number(kittyFunctionMatch[2])
                    : 1;
                const name =
                    KITTY_FUNCTION_KEYS[kittyFunctionMatch[3]];

                if (name) {
                    this.#emitKittyKey(
                        name,
                        modifierValue,
                        eventValue,
                    );
                }

                this.#buffer =
                    this.#buffer.slice(
                        kittyFunctionMatch[0].length,
                    );

                continue;
            }

            /*
             * Kitty/CSI tilde functional keys:
             *
             * ESC [ number ; modifiers:event ~
             *
             * Insert/Delete/PageUp/PageDown/F5~F12 등.
             */
            const kittyTildeMatch =
                /^\x1b\[(\d+)(?:;(\d+)(?::([123]))?)?~/.exec(
                    this.#buffer,
                );

            if (kittyTildeMatch) {
                const code = Number(kittyTildeMatch[1]);
                const name = KITTY_TILDE_KEYS[code];

                if (name) {
                    const modifierValue = kittyTildeMatch[2]
                        ? Number(kittyTildeMatch[2])
                        : 1;
                    const eventValue = kittyTildeMatch[3]
                        ? Number(kittyTildeMatch[3])
                        : 1;

                    this.#emitKittyKey(
                        name,
                        modifierValue,
                        eventValue,
                    );

                    this.#buffer =
                        this.#buffer.slice(
                            kittyTildeMatch[0].length,
                        );

                    continue;
                }
            }

            /*
             * Kitty/mouse가 아닌 완성된 legacy CSI sequence는
             * 기존 readline parser에 그대로 맡김.
             */
            const legacyCsiMatch =
                /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(
                    this.#buffer,
                );

            if (legacyCsiMatch) {
                this.#writeKeyboard(legacyCsiMatch[0]);

                this.#buffer =
                    this.#buffer.slice(legacyCsiMatch[0].length);

                continue;
            }

            // ESC[... 형태인데 아직 종료 문자가 도착하지 않음.
            if (/^\x1b\[[0-?]*[ -/]*$/.test(this.#buffer)) {
                return;
            }

            // Legacy SS3 sequence (일부 방향키/F키).
            if (this.#buffer.startsWith("\x1bO")) {
                if (this.#buffer.length < 3) {
                    return;
                }

                this.#writeKeyboard(this.#buffer.slice(0, 3));
                this.#buffer = this.#buffer.slice(3);

                continue;
            }

            // ESC 하나만 도착했다면 다음 데이터까지 기다림.
            if (this.#buffer === "\x1b") {
                return;
            }

            /*
             * Alt+key 같은 legacy 입력.
             * 다음 ESC 전까지 readline parser에 전달.
             */
            const nextEscapeIndex =
                this.#buffer.indexOf("\x1b", 1);
            const keyboardLength = nextEscapeIndex === -1
                ? this.#buffer.length
                : nextEscapeIndex;

            this.#writeKeyboard(
                this.#buffer.slice(0, keyboardLength),
            );

            this.#buffer =
                this.#buffer.slice(keyboardLength);
        }
    }

    #handleKittyCapabilityResponse(
        flags: number,
    ): void {
        /*
         * 첫 번째 응답이면 Kitty 지원 자체를 확인한 것.
         * 원하는 flags를 push한 뒤 다시 질의해서 실제 적용 여부를
         * 검증한다.
         */
        if (this.#kittyDetectionState === "probing") {
            this.#setKeyboardCapabilities(
                "kitty",
                false,
            );

            if (!this.#kittyKeyboardEnabled) {
                process.stdout.write(
                    `\x1b[>${KITTY_KEYBOARD_FLAGS}u`,
                );

                this.#kittyKeyboardEnabled = true;
            }

            this.#kittyDetectionState = "verifying";

            // 요청한 flags가 실제로 적용됐는지 다시 확인.
            process.stdout.write("\x1b[?u");

            return;
        }

        /*
         * 두 번째 응답.
         *
         * 0b10 = report event types
         * release/repeat 지원 여부는 이 bit가 실제로 켜졌는지로 판단.
         */
        if (
            this.#kittyDetectionState === "verifying" ||
            this.#keyboardProtocol === "kitty"
        ) {
            this.#setKeyboardCapabilities(
                "kitty",
                (flags & 2) !== 0,
            );

            this.#kittyDetectionState = "idle";
        }
    }

    #setKeyboardCapabilities(
        protocol: KeyboardProtocol,
        _nativeReleaseSupported: boolean,
    ): void {
        const changed =
            this.#keyboardProtocol !== protocol;

        this.#keyboardProtocol = protocol;

        if (protocol === "kitty") {
            // Native Kitty events take over from the legacy timer fallback.
            // Flush any key that may have been pressed while probing.
            this.#clearLegacyHeldKeys(true);
        }

        if (changed) {
            this.emit("capabilitieschange");
        }
    }

    #emitLegacyKey(
        key: Omit<PressedKey, "action">,
    ): void {
        /*
         * Once Kitty is active, keyboard input should arrive through Kitty
         * escape sequences. Ignore readline fallback events to prevent
         * duplicate key events.
         */
        if (this.#keyboardProtocol === "kitty") {
            return;
        }

        const id = this.#getLegacyKeyId(key);
        const now = Date.now();
        const existing = this.#legacyHeldKeys.get(id);

        if (!existing) {
            this.emit("keypress", {
                ...key,
                action: "press",
            });

            const held: LegacyHeldKey = {
                key,
                lastInputAt: now,
                timer: null,
            };

            held.timer = this.#scheduleLegacyRelease(
                id,
                held,
                LEGACY_INITIAL_RELEASE_DELAY_MS,
            );

            this.#legacyHeldKeys.set(id, held);
            return;
        }

        if (existing.timer) {
            clearTimeout(existing.timer);
        }

        const interval = Math.max(1, now - existing.lastInputAt);
        existing.lastInputAt = now;
        existing.key = key;

        this.emit("keypress", {
            ...key,
            action: "repeat",
        });

        const releaseDelay = Math.max(
            LEGACY_MIN_REPEAT_RELEASE_DELAY_MS,
            Math.min(
                LEGACY_MAX_REPEAT_RELEASE_DELAY_MS,
                Math.round(interval * 2.2),
            ),
        );

        existing.timer = this.#scheduleLegacyRelease(
            id,
            existing,
            releaseDelay,
        );
    }

    #scheduleLegacyRelease(
        id: string,
        held: LegacyHeldKey,
        delay: number,
    ): ReturnType<typeof setTimeout> {
        return setTimeout(() => {
            const current = this.#legacyHeldKeys.get(id);

            if (current !== held) return;

            this.#legacyHeldKeys.delete(id);

            this.emit("keypress", {
                ...held.key,
                action: "release",
            });
        }, delay);
    }

    #clearLegacyHeldKeys(emitRelease: boolean): void {
        for (const held of this.#legacyHeldKeys.values()) {
            if (held.timer) {
                clearTimeout(held.timer);
            }

            if (emitRelease) {
                this.emit("keypress", {
                    ...held.key,
                    action: "release",
                });
            }
        }

        this.#legacyHeldKeys.clear();
    }

    #getLegacyKeyId(
        key: Omit<PressedKey, "action">,
    ): string {
        return [
            key.name,
            key.shift ? "1" : "0",
            key.ctrl ? "1" : "0",
            key.alt ? "1" : "0",
            key.meta ? "1" : "0",
        ].join(":");
    }

    #writeKeyboard(input: string): void {
        if (input.length === 0) return;

        this.#keyboardStream.write(
            Buffer.from(input, "utf8"),
        );
    }

    #emitKittyKey(
        name: string,
        modifierValue: number,
        eventValue: number,
    ): void {
        const modifiers =
            Math.max(0, modifierValue - 1);

        this.emit("keypress", {
            name,
            action: this.#getKeyAction(eventValue),
            shift: (modifiers & 1) !== 0,
            alt: (modifiers & 2) !== 0,
            ctrl: (modifiers & 4) !== 0,
            meta:
                (modifiers & 8) !== 0 ||
                (modifiers & 32) !== 0,
        });
    }

    #getKeyAction(eventValue: number): KeyAction {
        switch (eventValue) {
            case 2:
                return "repeat";

            case 3:
                return "release";

            default:
                return "press";
        }
    }

    #getKittyKeyName(code: number): string {
        switch (code) {
            case 9:
                return "tab";

            case 13:
                return "return";

            case 27:
                return "escape";

            case 32:
                return "space";

            case 127:
                return "backspace";
        }

        const privateKey = KITTY_PRIVATE_KEYS[code];

        if (privateKey) {
            return privateKey;
        }

        // F13 ~ F35
        if (code >= 57376 && code <= 57398) {
            return `f${code - 57363}`;
        }

        if (
            code >= 0 &&
            code <= 0x10ffff &&
            !(code >= 0xd800 && code <= 0xdfff)
        ) {
            return String.fromCodePoint(code);
        }

        return `unknown-${code}`;
    }

    #emitMouse(
        code: number,
        x: number,
        y: number,
        pressed: boolean,
    ): void {
        const shift = (code & 4) !== 0;
        const alt = (code & 8) !== 0;
        const ctrl = (code & 16) !== 0;

        const motion = (code & 32) !== 0;
        const wheel = (code & 64) !== 0;

        const buttonCode = code & 3;

        let button: MouseInput["button"];
        let action: MouseInput["action"];

        if (wheel) {
            button = buttonCode === 0
                ? "wheelUp"
                : "wheelDown";

            action = "scroll";
        } else {
            switch (buttonCode) {
                case 0:
                    button = "left";
                    break;

                case 1:
                    button = "middle";
                    break;

                case 2:
                    button = "right";
                    break;

                default:
                    button = "none";
                    break;
            }

            if (motion) {
                action = button === "none"
                    ? "move"
                    : "drag";
            } else {
                action = pressed
                    ? "press"
                    : "release";
            }
        }

        this.emitMouse({
            x: x - 1,
            y: y - 1,
            button,
            action,
            shift,
            ctrl,
            alt,
        });
    }
}

const inputManager = new InputManager();

export default inputManager;