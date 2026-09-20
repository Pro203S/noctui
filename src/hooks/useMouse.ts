import { useEffect, useState } from "react";
import inputManager, { type MouseInput, } from "../modules/inputMgr.js";

export default function useMouse(): MouseInput | undefined {
    const [lastInputed, setLastInputed] = useState<MouseInput>();

    useEffect(() => {
        inputManager.initialize();

        const cb = (mouse: MouseInput) => {
            setLastInputed({ ...mouse });
        };

        inputManager.on("mouse", cb);

        return () => {
            inputManager.off("mouse", cb);
        };
    }, []);

    return lastInputed;
}