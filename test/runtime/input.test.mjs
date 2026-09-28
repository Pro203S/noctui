import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React, { act, createElement, createRef } from "react";
import Renderer from "../../.cache/input-runtime/render/index.js";
import Input from "../../.cache/input-runtime/components/Input.js";
import View from "../../.cache/input-runtime/components/View.js";
import inputManager from "../../.cache/input-runtime/modules/inputMgr.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function key(name, action = "press", modifiers = {}) {
    return {
        name,
        action,
        shift: false,
        ctrl: false,
        alt: false,
        meta: false,
        ...modifiers,
    };
}

async function captureWrites(action) {
    const writes = [];
    const originalWrite = process.stdout.write;

    process.stdout.write = (chunk) => {
        writes.push(String(chunk));
        return true;
    };

    try {
        await action();
    } finally {
        process.stdout.write = originalWrite;
    }

    return writes;
}

async function cleanup(renderer) {
    await captureWrites(async () => {
        await act(async () => {
            renderer.unmount();
        });

        inputManager.restore();
    });

    process.stdin.pause();
}

describe("Input", { concurrency: false }, () => {

test("Input only edits while focused and mirrors focus to the terminal cursor", {
    concurrency: false,
}, async () => {
    const ref = createRef();
    const renderer = new Renderer();

    try {
        let writes = await captureWrites(async () => {
            await act(async () => {
                renderer.render(createElement(Input, {
                    ref,
                    defaultValue: "한",
                }));
            });
        });

        assert.equal(ref.current.value, "한");
        assert.equal(ref.current.focused, false);
        assert.ok(writes.includes("\x1b[?25l"));

        const retainedHandle = ref.current;

        await captureWrites(async () => {
            await act(async () => {
                inputManager.emit("keypress", key("x"));
            });
        });

        assert.equal(ref.current.value, "한");

        writes = await captureWrites(async () => {
            await act(async () => {
                ref.current.focused = true;
            });
        });

        assert.equal(ref.current.focused, true);
        assert.ok(writes.includes("\x1b[?25h"));
        assert.ok(writes.includes("\x1b[1;3H"));

        await captureWrites(async () => {
            await act(async () => {
                inputManager.emit("keypress", key("a", "press", {
                    shift: true,
                }));
                inputManager.emit("keypress", key("👨‍👩‍👧‍👦"));
                inputManager.emit("keypress", key("z", "release"));
            });
        });

        assert.equal(ref.current.value, "한A👨‍👩‍👧‍👦");
        assert.equal(retainedHandle.value, "한A👨‍👩‍👧‍👦");

        await captureWrites(async () => {
            await act(async () => {
                inputManager.emit("keypress", key("backspace", "repeat"));
            });
        });

        assert.equal(ref.current.value, "한A");

        await captureWrites(async () => {
            await act(async () => {
                inputManager.emit("keypress", key("backspace", "press", {
                    ctrl: true,
                }));
                inputManager.emit("keypress", key("\n"));
            });
        });

        assert.equal(ref.current.value, "한A");

        writes = await captureWrites(async () => {
            await act(async () => {
                ref.current.focused = false;
                inputManager.emit("keypress", key("b"));
            });
        });

        assert.equal(ref.current.focused, false);
        assert.equal(ref.current.value, "한A");
        assert.ok(writes.includes("\x1b[?25l"));
    } finally {
        await cleanup(renderer);
    }
});

test("Input keeps one focus owner and releases the cursor on unmount", {
    concurrency: false,
}, async () => {
    const initialDataListeners = process.stdin.listenerCount("data");
    const firstRef = createRef();
    const secondRef = createRef();
    const renderer = new Renderer();

    try {
        await captureWrites(async () => {
            await act(async () => {
                renderer.render(createElement(View, null,
                    createElement(Input, { ref: firstRef }),
                    createElement(Input, { ref: secondRef }),
                ));
            });
        });

        await captureWrites(async () => {
            await act(async () => {
                firstRef.current.focused = true;
                secondRef.current.focused = true;
                inputManager.emit("keypress", key("q"));
            });
        });

        assert.equal(firstRef.current.focused, false);
        assert.equal(firstRef.current.value, "");
        assert.equal(secondRef.current.focused, true);
        assert.equal(secondRef.current.value, "q");

        const retainedHandle = secondRef.current;
        const writes = await captureWrites(async () => {
            await act(async () => {
                renderer.unmount();
            });
        });

        retainedHandle.clear();

        assert.equal(retainedHandle.value, "q");
        assert.ok(writes.includes("\x1b[?25l"));
        assert.equal(
            process.stdin.listenerCount("data"),
            initialDataListeners,
        );
    } finally {
        renderer.unmount();
        await captureWrites(async () => {
            inputManager.restore();
        });
        process.stdin.pause();
    }
});

test("Input remains focusable in React Strict Mode", {
    concurrency: false,
}, async () => {
    const ref = createRef();
    const renderer = new Renderer();

    try {
        await captureWrites(async () => {
            await act(async () => {
                renderer.render(createElement(
                    React.StrictMode,
                    null,
                    createElement(Input, { ref }),
                ));
            });
        });

        const writes = await captureWrites(async () => {
            await act(async () => {
                ref.current.focused = true;
            });
        });

        assert.equal(ref.current.focused, true);
        assert.ok(writes.includes("\x1b[?25h"));
    } finally {
        await cleanup(renderer);
    }
});

test("Input follows layout changes without rerendering itself", {
    concurrency: false,
}, async () => {
    const ref = createRef();
    const renderer = new Renderer();
    const stableInput = createElement(Input, { ref });

    const renderWithPrefix = (prefix) => captureWrites(async () => {
        await act(async () => {
            renderer.render(createElement(View, null,
                createElement(React.Fragment, null, prefix),
                stableInput,
            ));
        });
    });

    try {
        await renderWithPrefix(null);

        let writes = await captureWrites(async () => {
            await act(async () => {
                ref.current.focused = true;
            });
        });

        assert.ok(writes.includes("\x1b[1;1H"));

        writes = await renderWithPrefix("above");

        assert.ok(writes.includes("\x1b[2;1H"));
    } finally {
        await cleanup(renderer);
    }
});

test("Input positions the cursor in nested, wrapped, and moved layouts", {
    concurrency: false,
}, async () => {
    const ref = createRef();
    const renderer = new Renderer();

    const renderInput = async (marginLeft) => {
        return captureWrites(async () => {
            await act(async () => {
                renderer.render(createElement(View, {
                style: {
                    width: 3,
                    marginLeft,
                    paddingLeft: 1,
                    borderStyle: "solid",
                },
                }, createElement(Input, {
                    ref,
                    defaultValue: "abcd",
                })));
            });
        });
    };

    try {
        await renderInput(2);

        let writes = await captureWrites(async () => {
            await act(async () => {
                ref.current.focused = true;
            });
        });

        assert.ok(writes.includes("\x1b[3;6H"));

        writes = await renderInput(4);

        assert.ok(writes.includes("\x1b[3;8H"));
    } finally {
        await cleanup(renderer);
    }
});

});
