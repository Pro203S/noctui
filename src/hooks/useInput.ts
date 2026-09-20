import { useEffect, useState } from "react";
import inputManager, { type PressedKey, } from "../modules/inputMgr.js";

export default function useInput(): PressedKey | undefined {
    const [lastInputed, setLastInputed] =
        useState<PressedKey>();

    useEffect(() => {
        inputManager.initialize();

        const cb = (key: PressedKey) => {
            setLastInputed({ ...key });
        };

        inputManager.on("keypress", cb);

        return () => {
            inputManager.off("keypress", cb);
        };
    }, []);

    return lastInputed;
}