export type CursorPosition = {
    x: number;
    y: number;
};

export type CursorOwner = {
    blur(): void;
    getPosition(): CursorPosition | undefined;
};

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

let activeOwner: CursorOwner | undefined;

export function activateCursor(owner: CursorOwner): void {
    if (activeOwner !== owner) {
        const previousOwner = activeOwner;

        activeOwner = owner;
        previousOwner?.blur();
    }

    refreshActiveCursor();
}

export function deactivateCursor(owner: CursorOwner): void {
    if (activeOwner !== owner) {
        return;
    }

    activeOwner = undefined;
    process.stdout.write(HIDE_CURSOR);
}

export function releaseCursor(owner: CursorOwner): void {
    deactivateCursor(owner);
}

export function isActiveCursor(owner: CursorOwner): boolean {
    return activeOwner === owner;
}

export function hideCursorIfInactive(): void {
    if (!activeOwner) {
        process.stdout.write(HIDE_CURSOR);
    }
}

export function refreshActiveCursor(): void {
    const position = activeOwner?.getPosition();

    if (!position) {
        return;
    }

    process.stdout.write(`\x1b[${position.y};${position.x}H`);
    process.stdout.write(SHOW_CURSOR);
}
