import { createRef, type ComponentType } from "react";
import {
    Input,
    type InputProps,
    type InputRef,
} from "../../dist/index.js";

const ref = createRef<InputRef>();
const props: InputProps = {
    ref,
    defaultValue: "hello",
};
const InputComponent: ComponentType<InputProps> = Input;

void props;
void InputComponent;

if (ref.current) {
    ref.current.focused = true;

    const focused: boolean = ref.current.focused;
    const value: string = ref.current.value;

    ref.current.clear();

    void focused;
    void value;
}
