import {
    useImperativeHandle,
    useState,
    type Ref,
} from "react";

export type InputRef = {
    readonly value: string;
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

    useImperativeHandle(ref, () => ({
        get value() {
            return value;
        },
        clear() {
            setValue("");
        },
    }), [value]);

    // 실제 Input UI
    return null;
}