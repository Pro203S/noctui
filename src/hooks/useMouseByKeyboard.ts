import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import useCursor from "./useCursor.js";
import inputManager, {
    type PressedKey,
} from "../modules/inputMgr.js";

type Props = {
    initialEnabled?: boolean;
};

export type UseMouseByKeyboardResult = {
    position: {
        x: number;
        y: number;
    };

    isPressed: boolean;
    isEnabled: boolean;
    isKittySupported: boolean;

    enable: () => void;
    disable: () => void;
    toggle: () => void;
};

export default function useMouseByKeyboard(
    props?: Props,
): UseMouseByKeyboardResult {
    const [isEnabled, setIsEnabled] = useState(
        props?.initialEnabled ?? false,
    );

    const [position, setPosition] = useState({
        x: 1,
        y: 1,
    });

    const [isPressed, setIsPressed] = useState(false);

    const [isKittySupported, setIsKittySupported] = useState(
        inputManager.isKittySupported,
    );

    const enabledRef = useRef(isEnabled);
    const mouseXRef = useRef(1);
    const mouseYRef = useRef(1);
    const pressedRef = useRef(false);

    const {
        setShow,
        setX,
        setY,
    } = useCursor();

    const enable = useCallback(() => {
        setIsEnabled(true);
    }, []);

    const disable = useCallback(() => {
        setIsEnabled(false);
    }, []);

    const toggle = useCallback(() => {
        setIsEnabled(value => !value);
    }, []);

    useEffect(() => {
        enabledRef.current = isEnabled;

        setShow(isEnabled);

        if (isEnabled) {
            setX(mouseXRef.current);
            setY(mouseYRef.current);

            return;
        }

        /*
         * 비활성화될 때 Space가 눌려 있었다면
         * release 처리.
         */
        if (pressedRef.current) {
            pressedRef.current = false;
            setIsPressed(false);

            inputManager.emitMouse({
                x: mouseXRef.current - 1,
                y: mouseYRef.current - 1,
                button: "left",
                action: "release",
                shift: false,
                ctrl: false,
                alt: false,
            });
        }
    }, [
        isEnabled,
        setShow,
        setX,
        setY,
    ]);

    useEffect(() => {
        inputManager.initialize();

        const onCapabilitiesChange = () => {
            setIsKittySupported(
                inputManager.isKittySupported,
            );
        };

        const onKeypress = (input: PressedKey) => {
            if (!enabledRef.current) return;

            let x = mouseXRef.current;
            let y = mouseYRef.current;

            /*
             * Space = 왼쪽 마우스 버튼
             */
            if (input.name === "space") {
                if (input.action === "repeat") {
                    return;
                }

                const pressed =
                    input.action === "press";

                pressedRef.current = pressed;
                setIsPressed(pressed);

                inputManager.emitMouse({
                    x: x - 1,
                    y: y - 1,
                    button: "left",
                    action: pressed
                        ? "press"
                        : "release",
                    shift: input.shift,
                    ctrl: input.ctrl,
                    alt: input.alt,
                });

                return;
            }

            /*
             * release에서는 커서를 이동시키지 않음.
             */
            if (input.action === "release") {
                return;
            }

            const move = input.shift
                ? 2
                : 1;

            let moved = false;

            switch (input.name) {
                case "up":
                    y = Math.max(
                        1,
                        y - move,
                    );

                    moved = true;
                    break;

                case "down":
                    y += move;
                    moved = true;
                    break;

                case "left":
                    x = Math.max(
                        1,
                        x - move,
                    );

                    moved = true;
                    break;

                case "right":
                    x += move;
                    moved = true;
                    break;
            }

            if (!moved) return;

            mouseXRef.current = x;
            mouseYRef.current = y;

            setPosition({
                x,
                y,
            });

            setX(x);
            setY(y);

            inputManager.emitMouse({
                x: x - 1,
                y: y - 1,
                button: "none",
                action: "move",
                shift: input.shift,
                ctrl: input.ctrl,
                alt: input.alt,
            });
        };

        inputManager.on(
            "keypress",
            onKeypress,
        );

        inputManager.on(
            "capabilitieschange",
            onCapabilitiesChange,
        );

        setIsKittySupported(
            inputManager.isKittySupported,
        );

        return () => {
            inputManager.off(
                "keypress",
                onKeypress,
            );

            inputManager.off(
                "capabilitieschange",
                onCapabilitiesChange,
            );
        };
    }, [
        setX,
        setY,
    ]);

    return {
        position,
        isPressed,
        isEnabled,
        isKittySupported,

        enable,
        disable,
        toggle,
    };
}