// renderer

import Renderer from "./render/index.js";

export default Renderer;

// components

import View from "./components/View.js";
import Text from "./components/Text.js";
import Button from "./components/Button.js";
import Input from "./components/Input.js";

export {
    View,
    Text,
    Button,
    Input
};

// refs

import { type ViewRef } from "./components/View.js";
import { type TextRef } from "./components/Text.js";
import {
    type InputProps,
    type InputRef,
} from "./components/Input.js";

export {
    type ViewRef,
    type TextRef,
    type InputProps,
    type InputRef,
};

// hooks

import useConsoleSize from "./hooks/useConsoleSize.js";
import useInput from "./hooks/useInput.js";
import useMouse from "./hooks/useMouse.js";
import useCursor from "./hooks/useCursor.js";
import useMouseByKeyboard from "./hooks/useMouseByKeyboard.js";

export {
    useConsoleSize,
    useInput,
    useMouse,
    useCursor,
    useMouseByKeyboard
};
