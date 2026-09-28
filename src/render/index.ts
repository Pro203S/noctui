import type { ReactNode } from "react";
import { ConcurrentRoot } from "react-reconciler/constants.js";
import {
    createContainer,
    reconciler,
    type NoctUIContainer,
} from "./reconciler/index.js";
import CliManager from "../modules/cliMgr.js";
import inputManager from "../modules/inputMgr.js";

type ReconcilerRoot = ReturnType<typeof reconciler.createContainer>;

let hasActiveTerminalRenderer = false;

export default class Renderer {
    readonly #cliManager: CliManager;
    readonly #container: NoctUIContainer;
    readonly #root: ReconcilerRoot;
    readonly #ownsTerminal: boolean;

    #hasRendered = false;
    #renderError: Error | null = null;
    #isRendering = false;
    #isUnmounted = false;
    #isStarted = false;

    constructor() {
        this.#cliManager = new CliManager();
        this.#ownsTerminal = this.#cliManager.isTerminal;

        if (this.#ownsTerminal && hasActiveTerminalRenderer) {
            throw new Error("Only one terminal Renderer can be active at a time.");
        }

        this.#container = createContainer();

        this.#root = reconciler.createContainer(
            /*                      containerInfo */ this.#container,
            /*                                tag */ ConcurrentRoot,
            /*                 hydrationCallbacks */ null,
            /*                       isStrictMode */ false,
            /* concurrentUpdatesByDefaultOverride */ null,
            /*                   identifierPrefix */ "",
            /*                    onUncaughtError */(error) => this.#handleUncaughtError(error),
            /*                      onCaughtError */(error) => console.error(error),
            /*                 onRecoverableError */(error) => console.error(error),
            /*       onDefaultTransitionIndicator */() => { },
        );

        if (this.#ownsTerminal) {
            hasActiveTerminalRenderer = true;
        }
    }

    setTitle(title: string): void {
        process.stdout.write(`\x1b]0;${title}\x07`);
    }

    render(node: ReactNode): void {
        if (this.#isUnmounted) {
            throw new Error("Cannot render using an unmounted Renderer.");
        }

        if (!this.#isStarted) {
            this.#start();
        }

        this.#cliManager.initialize();

        this.#hasRendered = true;
        this.#renderError = null;
        this.#isRendering = true;

        try {
            // Flush synchronously so the terminal reflects the new React tree
            // before render() returns.
            reconciler.updateContainerSync(
                node,
                this.#root,
                null,
            );

            reconciler.flushSyncWork();

            if (this.#renderError !== null) {
                throw this.#renderError;
            }
        } finally {
            this.#isRendering = false;
        }
    }

    unmount(): void {
        if (this.#isUnmounted) {
            return;
        }

        try {
            if (this.#hasRendered) {
                this.#container.preserveOutput = true;

                try {
                    this.render(null);
                } finally {
                    this.#container.preserveOutput = false;
                }
            }
        } finally {
            this.#isUnmounted = true;

            try {
                inputManager.restore();
            } finally {
                try {
                    this.#cliManager.restore();
                } finally {
                    this.#stop();

                    if (this.#ownsTerminal) {
                        hasActiveTerminalRenderer = false;
                    }
                }
            }
        }
    }

    #start(): void {
        if (this.#isStarted || !this.#ownsTerminal) {
            return;
        }

        this.#isStarted = true;

        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.on("data", this.#handleInput);
    }

    readonly #handleInput = (data: Buffer): void => {
        // Ctrl+C
        if (data.includes(0x03)) {
            this.unmount();
            process.exit(130);
        }
    };

    #stop(): void {
        if (!this.#isStarted) {
            return;
        }

        this.#isStarted = false;

        process.stdin.off("data", this.#handleInput);
        process.removeListener("SIGINT", this.#handleSigint);
        process.stdin.pause();
    }

    readonly #handleSigint = (): void => {
        this.unmount();

        // 128 + SIGINT(2)
        process.exit(130);
    };

    #handleUncaughtError(error: Error): void {
        if (this.#isRendering) {
            this.#renderError = error;
            return;
        }

        // Errors raised outside render() cannot be returned to its caller.
        queueMicrotask(() => {
            throw error;
        });
    }
}
