import {
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
    type Ref,
} from "react";
import stringWidth from "string-width";
import inputManager, {
    type PressedKey,
} from "../modules/inputMgr.js";
import {
    activateCursor,
    deactivateCursor,
    hideCursorIfInactive,
    isActiveCursor,
    releaseCursor,
    type CursorOwner,
} from "../modules/cursorMgr.js";
import Text from "./Text.js";
import View, { type ViewRef } from "./View.js";

const graphemes = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
});

const CONTROL_CHARACTER = /\p{Cc}/u;

function getCursorOffset(
    value: string,
    width: number,
): { x: number; y: number } {
    const maximumWidth = Math.max(1, width);
    let x = 0;
    let y = 0;

    for (const { segment } of graphemes.segment(value)) {
        if (segment === "\n") {
            x = 0;
            y += 1;
            continue;
        }

        const segmentWidth = Math.min(2, stringWidth(segment));

        if (
            x > 0 &&
            x + segmentWidth > maximumWidth
        ) {
            x = 0;
            y += 1;
        }

        if (segmentWidth <= maximumWidth) {
            x += segmentWidth;
        }
    }

    if (x > 0 && x + 1 > maximumWidth) {
        x = 0;
        y += 1;
    }

    return {
        x: x + 1,
        y: y + 1,
    };
}

export type InputRef = {
    readonly value: string;
    focused: boolean;
    clear(): void;
};

export type InputProps = {
    ref?: Ref<InputRef>;
    defaultValue?: string;
};

export default function Input({
    ref,
    defaultValue = "",
}: InputProps) {
    const [value, setValue] = useState(defaultValue);
    const valueRef = useRef(defaultValue);
    const focusedRef = useRef(false);
    const mountedRef = useRef(true);
    const viewRef = useRef<ViewRef>(null);
    const cursorOwnerRef = useRef<CursorOwner>(null);

    if (!cursorOwnerRef.current) {
        cursorOwnerRef.current = {
            blur() {
                focusedRef.current = false;
            },
            getPosition() {
                if (
                    !mountedRef.current ||
                    !focusedRef.current ||
                    !viewRef.current
                ) {
                    return undefined;
                }

                const offset = getCursorOffset(
                    valueRef.current,
                    viewRef.current.width,
                );

                return {
                    x: viewRef.current.x + offset.x,
                    y: viewRef.current.y + offset.y,
                };
            },
        };
    }

    const cursorOwner = cursorOwnerRef.current;

    const updateValue = (
        updater: (currentValue: string) => string,
    ) => {
        const nextValue = updater(valueRef.current);

        valueRef.current = nextValue;
        setValue(nextValue);
    };

    useImperativeHandle(ref, () => ({
        get value() {
            return valueRef.current;
        },
        get focused() {
            return focusedRef.current;
        },
        set focused(nextFocused: boolean) {
            if (!mountedRef.current) {
                return;
            }

            if (nextFocused) {
                focusedRef.current = true;
                activateCursor(cursorOwner);
            } else {
                focusedRef.current = false;
                deactivateCursor(cursorOwner);
            }
        },
        clear() {
            if (!mountedRef.current) {
                return;
            }

            updateValue(() => "");
        },
    }), []);

    useEffect(() => {
        inputManager.initialize();

        const onKeypress = (input: PressedKey) => {
            if (
                !focusedRef.current ||
                !isActiveCursor(cursorOwner) ||
                input.action === "release"
            ) {
                return;
            }

            if (input.ctrl || input.alt || input.meta) {
                return;
            }

            if (input.name === "backspace") {
                updateValue(currentValue => {
                    const segments = Array.from(
                        graphemes.segment(currentValue),
                    );
                    const last = segments.at(-1);

                    return last
                        ? currentValue.slice(0, last.index)
                        : currentValue;
                });

                return;
            }

            let character = input.name === "space"
                ? " "
                : input.name;

            const segments = Array.from(
                graphemes.segment(character),
            );

            if (
                segments.length !== 1 ||
                segments[0]?.segment !== character ||
                CONTROL_CHARACTER.test(character)
            ) {
                return;
            }

            if (
                input.shift &&
                /^[a-z]$/.test(character)
            ) {
                character = character.toUpperCase();
            }

            updateValue(currentValue => currentValue + character);
        };

        inputManager.on("keypress", onKeypress);

        return () => {
            inputManager.off("keypress", onKeypress);
        };
    }, []);

    useLayoutEffect(() => {
        mountedRef.current = true;
        hideCursorIfInactive();

        return () => {
            mountedRef.current = false;
            focusedRef.current = false;
            releaseCursor(cursorOwner);
        };
    }, []);

    return <View ref={viewRef}>
        <Text>{value} </Text>
    </View>;
}
