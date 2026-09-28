import { createContext } from "react";
import Reconciler from "react-reconciler";
import {
    DefaultEventPriority,
    NoEventPriority,
} from "react-reconciler/constants.js";
import { createHostInstance } from "./components/index.js";
import { renderLayoutChildren } from "../layout/index.js";
import type { NoctUIText } from "./components/Text.js";
import type { TextRef } from "../../components/Text.js";
import type { ViewRef } from "../../components/View.js";
import type { NoctUIView } from "./components/View.js";
import { refreshActiveCursor } from "../../modules/cursorMgr.js";

export type HostProps = Readonly<Record<string, unknown>>;

export type HostComponent<
    Props extends HostProps = HostProps,
    Children = string,
    Output = string,
    Constraints = undefined,
> = Readonly<{
    type: string;
    render(props: Props, children: Children, constraints?: Constraints): Output;
}>;

export type NoctUITextInstance = {
    readonly kind: "text";
    text: string;
    hidden: boolean;
};

export type NoctUIHostInstance = NoctUIView | NoctUIText;

export type NoctUIChild = NoctUIHostInstance | NoctUITextInstance;

export type NoctUIContainer = {
    readonly children: NoctUIChild[];
    renderedText: string;
    preserveOutput: boolean;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;
type HostContext = Readonly<Record<string, never>>;

// React uses null to indicate a missing host context.
const rootHostContext: HostContext = Object.freeze({});

type HostConfig = Reconciler.HostConfig<
    /*                Type */  string,
    /*               Props */  HostProps,
    /*           Container */  NoctUIContainer,
    /*            Instance */  NoctUIHostInstance,
    /*        TextInstance */  NoctUITextInstance,
    /*    SuspenseInstance */  never,
    /*  HydratableInstance */  never,
    /*        FormInstance */  never,
    /*      PublicInstance */  ViewRef | TextRef | NoctUITextInstance,
    /*         HostContext */  HostContext,
    /*            ChildSet */  never,
    /*       TimeoutHandle */  TimeoutHandle,
    /*           NoTimeout */  -1,
    /*    TransitionStatus */  null
>;

let currentUpdatePriority: Reconciler.EventPriority = NoEventPriority;

const hostTransitionContext = createContext<null>(null) as unknown as
    Reconciler.ReactContext<null>;

function append(children: NoctUIChild[], child: NoctUIChild): void {
    remove(children, child);
    children.push(child);
}

function remove(children: NoctUIChild[], child: NoctUIChild): void {
    const index = children.indexOf(child);

    if (index !== -1) {
        children.splice(index, 1);
    }
}

function insert(
    children: NoctUIChild[],
    child: NoctUIChild,
    beforeChild: NoctUIChild,
): void {
    if (child === beforeChild) {
        return;
    }

    remove(children, child);

    const index = children.indexOf(beforeChild);

    if (index === -1) {
        throw new Error("Cannot insert host child: target sibling was not found.");
    }

    children.splice(index, 0, child);
}

function redraw(container: NoctUIContainer): void {
    if (container.preserveOutput) {
        return;
    }

    process.stdout.write("\x1b[s");

    let nextText = renderLayoutChildren(container.children);

    if (nextText === container.renderedText) {
        if (process.stdout.isTTY === true) {
            process.stdout.write("\x1b[u");
        }

        refreshActiveCursor();
        return;
    }

    if (process.stdout.isTTY !== true) {
        if (nextText.length > 0) {
            process.stdout.write(nextText);
        }

        container.renderedText = nextText;
        refreshActiveCursor();
        return;
    }

    if (container.renderedText.length > 0) {
        const lineCount = container.renderedText.split("\n").length;
        const moveToStart = lineCount > 1
            ? `\r\u001B[${lineCount - 1}A`
            : "\r";

        process.stdout.write(`${moveToStart}\u001B[0J`);
    }

    process.stdout.write("\x1b[H\x1b[0J");

    if (nextText.length > 0) {
        process.stdout.write(nextText);
    }

    container.renderedText = nextText;

    process.stdout.write("\x1b[u");
    refreshActiveCursor();
}

const hostConfig: HostConfig = {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    isPrimaryRenderer: true,
    warnsIfNotActing: false,

    createInstance(type, props) {
        return createHostInstance(type, props);
    },

    createTextInstance(text) {
        return {
            kind: "text",
            text,
            hidden: false,
        };
    },

    appendInitialChild(parent, child) {
        append(parent.children, child);
    },

    appendChild(parent, child) {
        append(parent.children, child);
    },

    appendChildToContainer(container, child) {
        append(container.children, child);
    },

    removeChild(parent, child) {
        remove(parent.children, child);
    },

    removeChildFromContainer(container, child) {
        remove(container.children, child);
    },

    insertBefore(parent, child, beforeChild) {
        insert(parent.children, child, beforeChild);
    },

    insertInContainerBefore(container, child, beforeChild) {
        insert(container.children, child, beforeChild);
    },

    commitUpdate(instance, _type, _oldProps, newProps) {
        instance.props = newProps;
    },

    commitTextUpdate(instance, _oldText, newText) {
        instance.text = newText;
    },

    resetTextContent(instance) {
        instance.children.length = 0;
    },

    clearContainer(container) {
        container.children.length = 0;
    },

    hideInstance(instance) {
        instance.hidden = true;
    },

    hideTextInstance(instance) {
        instance.hidden = true;
    },

    unhideInstance(instance) {
        instance.hidden = false;
    },

    unhideTextInstance(instance, text) {
        instance.hidden = false;
        instance.text = text;
    },

    getRootHostContext() {
        return rootHostContext;
    },

    getChildHostContext(parentHostContext) {
        return parentHostContext;
    },

    getPublicInstance(instance) {
        if (instance.kind === "text") {
            return instance;
        }

        return instance.publicInstance;
    },

    prepareForCommit() {
        return null;
    },

    resetAfterCommit(container) {
        redraw(container);
    },

    finalizeInitialChildren() {
        return false;
    },

    shouldSetTextContent() {
        return false;
    },

    preparePortalMount() { },

    getInstanceFromNode() {
        return null;
    },

    beforeActiveInstanceBlur() { },
    afterActiveInstanceBlur() { },
    prepareScopeUpdate() { },

    getInstanceFromScope() {
        return null;
    },

    detachDeletedInstance() { },

    scheduleTimeout(callback, delay) {
        return setTimeout(callback, delay);
    },

    cancelTimeout(handle) {
        clearTimeout(handle);
    },

    noTimeout: -1,

    scheduleMicrotask(callback) {
        queueMicrotask(callback);
    },

    getCurrentUpdatePriority() {
        return currentUpdatePriority;
    },

    setCurrentUpdatePriority(priority) {
        currentUpdatePriority = priority;
    },

    resolveUpdatePriority() {
        return currentUpdatePriority === NoEventPriority
            ? DefaultEventPriority
            : currentUpdatePriority;
    },

    maySuspendCommit() {
        return false;
    },

    preloadInstance() {
        return true;
    },

    startSuspendingCommit() { },
    suspendInstance() { },

    waitForCommitToBeReady() {
        return null;
    },

    NotPendingTransition: null,
    HostTransitionContext: hostTransitionContext,

    resetFormInstance() { },

    requestPostPaintCallback(callback) {
        setTimeout(() => callback(Date.now()), 0);
    },

    shouldAttemptEagerTransition() {
        return false;
    },

    trackSchedulerEvent() { },

    resolveEventType() {
        return null;
    },

    resolveEventTimeStamp() {
        return -1;
    },
};

export function createContainer(): NoctUIContainer {
    return {
        children: [],
        renderedText: "",
        preserveOutput: false,
    };
}

export const reconciler = Reconciler(hostConfig);
