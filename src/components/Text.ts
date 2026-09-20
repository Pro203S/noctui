import React, { type ReactNode, type Ref } from "react";
import type { TextStyle } from "../render/styles.js";

export const COMPONENT_NAME = "noctui-text" as const;

export type TextRef = {
    content: string;
};

export type TextProps = {
    style?: TextStyle;
    children?: ReactNode;
    ref?: Ref<TextRef>;
};

export default function Text(props: TextProps) {
    return React.createElement(COMPONENT_NAME, props);
}
