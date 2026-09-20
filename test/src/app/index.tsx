import { Button, Text, useInput, useMouse, useMouseByKeyboard, View } from "noctui";
import { useEffect, useState } from "react";

export default function App() {
    const keyboard = useMouseByKeyboard();
    const input = useInput();
    const mouse = useMouse();
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!input) return;

        if (input.shift && input.name === "tab" && input.action === "press") {
            keyboard.toggle();
        }
    }, [input]);

    return <View>
        <Button label="pressme" onClick={() => setCount(v => v + 1)} />
        <Text>{JSON.stringify(input)}</Text>
        <Text>{count}</Text>
    </View>;
}
