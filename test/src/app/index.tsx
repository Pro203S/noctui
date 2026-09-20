import { Button, Text, useInput, useMouse, useMouseByKeyboard, View } from "noctui";
import { useState } from "react";

export default function App() {
    const mouseByKeyboard = useMouseByKeyboard({ "initialStatus": true });
    const input = useInput();
    const mouse = useMouse();
    const [count, setCount] = useState(0);

    return <View>
        <Button label="pressme" onClick={() => setCount(v => v + 1)}/>
        <Text>{JSON.stringify(input, null, 4)}</Text>
        <Text>{JSON.stringify(mouse, null, 4)}</Text>
        <Text>{count}</Text>
    </View>;
}
