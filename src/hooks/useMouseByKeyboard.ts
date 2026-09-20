import { useCallback, useEffect, useRef } from "react";
import useCursor from "./useCursor.js";
import inputManager, { type PressedKey } from "../modules/inputMgr.js";

type Props = {
    initialStatus?: boolean;
};

export default function useMouseByKeyboard(props?: Props) {
    const enabledRef = useRef(props?.initialStatus ?? false);

    const mouseXRef = useRef(1);
    const mouseYRef = useRef(1);

    const {
        setShow,
        setX,
        setY,
    } = useCursor();

    useEffect(() => {
        inputManager.initialize();

        setShow(enabledRef.current);

        if (enabledRef.current) {
            setX(mouseXRef.current);
            setY(mouseYRef.current);
        }

        const onKeypress = (input: PressedKey) => {
            if (!enabledRef.current) return;

            if (input.action === "release") {
                if (input.name !== "space") {
                    return;
                }
            }

            const move = input.shift ? 2 : 1;

            let x = mouseXRef.current;
            let y = mouseYRef.current;
            let moved = false;

            switch (input.name) {
                case "up":
                    y = Math.max(1, y - move);
                    moved = true;
                    break;

                case "down":
                    y += move;
                    moved = true;
                    break;

                case "left":
                    x = Math.max(1, x - move);
                    moved = true;
                    break;

                case "right":
                    x += move;
                    moved = true;
                    break;

                case "space": {
                    if (input.action === "repeat") {
                        return;
                    }

                    inputManager.emitMouse({
                        x: x - 1,
                        y: y - 1,
                        button: "left",
                        action: input.action,
                        shift: input.shift,
                        ctrl: input.ctrl,
                        alt: input.alt,
                    });

                    return;
                }
            }

            if (!moved) return;

            mouseXRef.current = x;
            mouseYRef.current = y;

            setX(x);
            setY(y);

            inputManager.emitMouse({
                "x": x - 1,
                "y": y - 1,
                "button": "none",
                "action": "move",
                "shift": input.shift,
                "ctrl": input.ctrl,
                "alt": input.alt,
            });
        };

        inputManager.on("keypress", onKeypress);

        return () => {
            inputManager.off("keypress", onKeypress);
        };
    }, [setShow, setX, setY]);

    return useCallback((enable: boolean) => {
        enabledRef.current = enable;

        setShow(enable);

        if (enable) {
            setX(mouseXRef.current);
            setY(mouseYRef.current);
        }
    }, [setShow, setX, setY]);
}