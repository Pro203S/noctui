import { ViewStyle } from "../render/styles.js";
import View, { ViewRef } from "./View.js";
import useMouse from "../hooks/useMouse.js";
import { useEffect, useRef, useState } from "react";
import Text from "./Text.js";

type Props = {
    "label": string,
    "onClick"?: () => any;
    "style"?: ViewStyle,
    "hoverStyle"?: ViewStyle
    "clickStyle"?: ViewStyle
};

const INITIAL_STYLE: ViewStyle = {
    "borderStyle": "solid",
    "borderColor": "white"
};

export default function Button(props: Props) {
    const { label, onClick, style, hoverStyle, clickStyle } = props;
    const [currentStyle, setCurrentStyle] = useState(props.style ?? INITIAL_STYLE);
    const mouse = useMouse();
    const ref = useRef<ViewRef>(null);

    useEffect(() => {
        if (!mouse || !ref.current) return;

        const hovering =
            ref.current.x <= mouse.x &&
            mouse.x < ref.current.x + ref.current.width &&
            ref.current.y <= mouse.y &&
            mouse.y < ref.current.y + ref.current.height;

        if (
            hovering &&
            (mouse.action === "move" || mouse.action === "drag")
        ) {
            setCurrentStyle(v => hoverStyle ?? {
                ...v,
                "borderStyle": "doubleline",
            });
        } else {
            setCurrentStyle(style ?? INITIAL_STYLE);
        }

        if (hovering && mouse.action === "press") {
            onClick?.();
            setCurrentStyle(v => clickStyle ?? {
                ...v,
                "borderStyle": "doubleline",
                "borderColor": "blue"
            });
        }

        if (hovering && mouse.action === "release") {
            setCurrentStyle(v => hoverStyle ?? {
                ...v,
                "borderStyle": "doubleline",
                "borderColor": "white"
            });
        }
    }, [mouse]);

    return <View style={currentStyle} ref={ref}>
        <Text>{label}</Text>
    </View>;
}