import type { ViewStyle } from "../styles.js";
import {
    paintBackground,
    resolveColor,
    type BackgroundPaint,
} from "./color.js";
import { createGrid, overlayGrid, placeGlyph } from "./grid.js";
import {
    normalizeCellCount,
    resolvePosition,
    resolveSpacing,
} from "./style.js";
import type {
    LayoutChild,
    LayoutConstraints,
    LayoutResult,
    ViewLayoutInput,
} from "./types.js";

type LaidOutChild = {
    readonly child: LayoutChild;
    readonly result: LayoutResult;
};

type Direction = "row" | "column";

type Distribution = {
    readonly leading: number;
    readonly gaps: readonly number[];
};

type PaintRecord = {
    readonly child: LayoutChild;
    readonly result: LayoutResult;
    readonly flowX: number;
    readonly flowY: number;
    readonly sourceIndex: number;
};

const BORDER_GLYPHS = {
    solid: {
        normal: {
            top: "─", right: "│", bottom: "─", left: "│",
            topLeft: "┌", topRight: "┐", bottomRight: "┘", bottomLeft: "└",
        },
        bold: {
            top: "━", right: "┃", bottom: "━", left: "┃",
            topLeft: "┏", topRight: "┓", bottomRight: "┛", bottomLeft: "┗",
        },
    },
    dotted: {
        normal: {
            top: "┄", right: "┊", bottom: "┄", left: "┊",
            topLeft: "┌", topRight: "┐", bottomRight: "┘", bottomLeft: "└",
        },
        bold: {
            top: "┅", right: "┋", bottom: "┅", left: "┋",
            topLeft: "┏", topRight: "┓", bottomRight: "┛", bottomLeft: "┗",
        },
    },
    doubleline: {
        normal: {
            top: "═", right: "║", bottom: "═", left: "║",
            topLeft: "╔", topRight: "╗", bottomRight: "╝", bottomLeft: "╚",
        },
        bold: {
            top: "═", right: "║", bottom: "═", left: "║",
            topLeft: "╔", topRight: "╗", bottomRight: "╝", bottomLeft: "╚",
        },
    },
} as const;

function resolveOwnDimension(
    explicit: number | undefined,
    stretch: number | undefined,
): number | undefined {
    return normalizeCellCount(explicit) ?? normalizeCellCount(stretch);
}

function constrainAutoDimension(
    natural: number,
    maximum: number | undefined,
): number {
    const normalizedMaximum = normalizeCellCount(maximum);
    return normalizedMaximum === undefined
        ? natural
        : Math.min(natural, normalizedMaximum);
}

function layoutChildren(
    children: readonly LayoutChild[],
    maximumWidth?: number,
): LaidOutChild[] {
    return children.map((child) => {
        const naturalResult = child.layout();
        const result = maximumWidth === undefined ||
            naturalResult.position.mode === "absolute"
            ? naturalResult
            : child.layout({ maxWidth: maximumWidth });

        return { child, result };
    });
}

function isInFlow(child: LaidOutChild): boolean {
    return child.result.position.mode !== "absolute";
}

function outerWidth(result: LayoutResult): number {
    return result.margin.left + result.grid.width + result.margin.right;
}

function outerHeight(result: LayoutResult): number {
    return result.margin.top + result.grid.height + result.margin.bottom;
}

function getNaturalBlockWidth(children: readonly LaidOutChild[]): number {
    return children.reduce((width, child) => (
        isInFlow(child) ? Math.max(width, outerWidth(child.result)) : width
    ), 0);
}

function getNaturalBlockHeight(children: readonly LaidOutChild[]): number {
    return children.reduce((height, child) => (
        isInFlow(child) ? height + outerHeight(child.result) : height
    ), 0);
}

function getNaturalFlexSize(
    children: readonly LaidOutChild[],
    direction: Direction,
): { width: number; height: number } {
    const inFlow = children.filter(isInFlow);

    if (direction === "row") {
        return {
            width: inFlow.reduce(
                (width, child) => width + outerWidth(child.result),
                0,
            ),
            height: inFlow.reduce(
                (height, child) => Math.max(height, outerHeight(child.result)),
                0,
            ),
        };
    }

    return {
        width: inFlow.reduce(
            (width, child) => Math.max(width, outerWidth(child.result)),
            0,
        ),
        height: inFlow.reduce(
            (height, child) => height + outerHeight(child.result),
            0,
        ),
    };
}

function placeBlockChildren(
    children: readonly LaidOutChild[],
): PaintRecord[] {
    const records: PaintRecord[] = [];
    let y = 0;

    for (const child of children) {
        if (!isInFlow(child)) {
            records.push({
                child: child.child,
                result: child.result,
                flowX: 0,
                flowY: 0,
                sourceIndex: child.child.sourceIndex,
            });
            continue;
        }

        const { result } = child;
        y += result.margin.top;
        records.push({
            child: child.child,
            result,
            flowX: result.margin.left,
            flowY: y,
            sourceIndex: child.child.sourceIndex,
        });
        y += result.grid.height + result.margin.bottom;
    }

    return records;
}

function distribute(
    freeSpace: number,
    itemCount: number,
    mode: ViewStyle["justifyContent"],
): Distribution {
    const space = Math.max(0, freeSpace);

    switch (mode ?? "flex-start") {
        case "center":
            return { leading: Math.floor(space / 2), gaps: [] };
        case "flex-end":
            return { leading: space, gaps: [] };
        case "space-between": {
            if (itemCount <= 1) {
                return { leading: 0, gaps: [] };
            }

            const gapCount = itemCount - 1;
            const base = Math.floor(space / gapCount);
            const remainder = space % gapCount;

            return {
                leading: 0,
                gaps: Array.from(
                    { length: gapCount },
                    (_, index) => base + (index < remainder ? 1 : 0),
                ),
            };
        }
        case "space-evenly": {
            const slotCount = itemCount + 1;
            const base = Math.floor(space / slotCount);
            const remainder = space % slotCount;
            const slots = Array.from(
                { length: slotCount },
                (_, index) => base + (index < remainder ? 1 : 0),
            );

            return {
                leading: slots[0] ?? 0,
                gaps: slots.slice(1, itemCount),
            };
        }
        case "flex-start":
            return { leading: 0, gaps: [] };
    }
}

function stretchFlexChildren(
    children: readonly LaidOutChild[],
    direction: Direction,
    crossSize: number,
    alignItems: ViewStyle["alignItems"],
): LaidOutChild[] {
    if (alignItems !== "stretch") {
        return [...children];
    }

    return children.map((child) => {
        if (!isInFlow(child)) {
            return child;
        }

        const { result } = child;

        if (direction === "row" && result.autoHeight) {
            return {
                child: child.child,
                result: child.child.layout({
                    stretchHeight: Math.max(
                        0,
                        crossSize - result.margin.top - result.margin.bottom,
                    ),
                }),
            };
        }

        if (direction === "column" && result.autoWidth) {
            return {
                child: child.child,
                result: child.child.layout({
                    stretchWidth: Math.max(
                        0,
                        crossSize - result.margin.left - result.margin.right,
                    ),
                }),
            };
        }

        return child;
    });
}

function crossOffset(
    result: LayoutResult,
    direction: Direction,
    crossSize: number,
    alignItems: ViewStyle["alignItems"],
): number {
    const before = direction === "row"
        ? result.margin.top
        : result.margin.left;
    const after = direction === "row"
        ? result.margin.bottom
        : result.margin.right;
    const size = direction === "row"
        ? result.grid.height
        : result.grid.width;
    const freeSpace = Math.max(0, crossSize - before - size - after);

    switch (alignItems ?? "stretch") {
        case "center":
            return before + Math.floor(freeSpace / 2);
        case "flex-end":
            return before + freeSpace;
        case "stretch":
        case "flex-start":
            return before;
    }
}

function placeFlexChildren(
    children: readonly LaidOutChild[],
    width: number,
    height: number,
    direction: Direction,
    justifyContent: ViewStyle["justifyContent"],
    alignItems: ViewStyle["alignItems"],
): PaintRecord[] {
    const records: PaintRecord[] = children
        .filter((child) => !isInFlow(child))
        .map((child) => ({
            child: child.child,
            result: child.result,
            flowX: 0,
            flowY: 0,
            sourceIndex: child.child.sourceIndex,
        }));
    const inFlow = children.filter(isInFlow);
    const mainSize = direction === "row" ? width : height;
    const usedMainSize = inFlow.reduce((size, { result }) => (
        size + (direction === "row" ? outerWidth(result) : outerHeight(result))
    ), 0);
    const distribution = distribute(
        mainSize - usedMainSize,
        inFlow.length,
        justifyContent,
    );
    const crossSize = direction === "row" ? height : width;
    let mainPosition = distribution.leading;

    inFlow.forEach(({ child, result }, index) => {
        const mainBefore = direction === "row"
            ? result.margin.left
            : result.margin.top;
        const mainAfter = direction === "row"
            ? result.margin.right
            : result.margin.bottom;
        const childMainSize = direction === "row"
            ? result.grid.width
            : result.grid.height;
        const childCrossPosition = crossOffset(
            result,
            direction,
            crossSize,
            alignItems,
        );

        mainPosition += mainBefore;
        records.push({
            child,
            result,
            flowX: direction === "row" ? mainPosition : childCrossPosition,
            flowY: direction === "row" ? childCrossPosition : mainPosition,
            sourceIndex: child.sourceIndex,
        });
        mainPosition += childMainSize + mainAfter;
        mainPosition += distribution.gaps[index] ?? 0;
    });

    return records;
}

function getPaintCoordinates(
    record: PaintRecord,
    width: number,
    height: number,
): { x: number; y: number } {
    const { result } = record;
    const { position } = result;

    if (position.mode === "static") {
        return { x: record.flowX, y: record.flowY };
    }

    if (position.mode === "relative") {
        return {
            x: record.flowX + (
                position.left ?? (position.right === undefined ? 0 : -position.right)
            ),
            y: record.flowY + (
                position.top ?? (position.bottom === undefined ? 0 : -position.bottom)
            ),
        };
    }

    return {
        x: position.left === undefined
            ? position.right === undefined
                ? result.margin.left
                : width - position.right - result.grid.width - result.margin.right
            : position.left + result.margin.left,
        y: position.top === undefined
            ? position.bottom === undefined
                ? result.margin.top
                : height - position.bottom - result.grid.height - result.margin.bottom
            : position.top + result.margin.top,
    };
}

function paintRecords(
    records: readonly PaintRecord[],
    width: number,
    height: number,
    layoutOffsetX = 0,
    layoutOffsetY = 0,
) {
    const grid = createGrid(width, height);
    const paintOrder = [...records].sort((left, right) => (
        left.result.position.zIndex - right.result.position.zIndex ||
        left.sourceIndex - right.sourceIndex
    ));

    for (const record of paintOrder) {
        const { x, y } = getPaintCoordinates(record, width, height);
        record.child.setLayout({
            x: x + layoutOffsetX,
            y: y + layoutOffsetY,
            width: record.result.grid.width,
            height: record.result.grid.height,
        });
        overlayGrid(grid, record.result.grid, x, y);
    }

    return grid;
}

function hasBorder(style: Readonly<ViewStyle>): boolean {
    return style.borderStyle !== undefined ||
        style.borderWidth !== undefined ||
        style.borderColor !== undefined;
}

function addPadding(
    content: ReturnType<typeof createGrid>,
    style: Readonly<ViewStyle>,
) {
    const padding = resolveSpacing(style, "padding");
    const grid = createGrid(
        padding.left + content.width + padding.right,
        padding.top + content.height + padding.bottom,
    );

    overlayGrid(grid, content, padding.left, padding.top);
    return grid;
}

function paintViewBackground(
    grid: ReturnType<typeof createGrid>,
    style: Readonly<ViewStyle>,
) {
    const gradientStart = resolveColor(style.backgroundGradient?.start);
    const gradientEnd = resolveColor(style.backgroundGradient?.end);
    let paint: BackgroundPaint | undefined;

    if (gradientStart !== undefined && gradientEnd !== undefined) {
        paint = {
            type: "gradient",
            start: gradientStart,
            end: gradientEnd,
            rotation: style.backgroundGradient?.rotation ?? 0,
        };
    } else {
        const color = resolveColor(style.backgroundColor);
        if (color !== undefined) {
            paint = { type: "solid", color };
        }
    }

    if (paint !== undefined) {
        paintBackground(grid, paint);
    }

    return grid;
}

function addBorder(
    inner: ReturnType<typeof createGrid>,
    style: Readonly<ViewStyle>,
) {
    if (!hasBorder(style)) {
        return inner;
    }

    const borderStyle = style.borderStyle ?? "solid";
    const borderWidth = style.borderWidth ?? "normal";
    const borderColor = resolveColor(style.borderColor ?? "white");
    const glyphs = BORDER_GLYPHS[borderStyle][borderWidth];
    const grid = createGrid(inner.width + 2, inner.height + 2);
    const right = grid.width - 1;
    const bottom = grid.height - 1;

    overlayGrid(grid, inner, 1, 1);

    for (let x = 1; x < right; x += 1) {
        placeGlyph(grid, x, 0, glyphs.top, 1, "", "", borderColor);
        placeGlyph(grid, x, bottom, glyphs.bottom, 1, "", "", borderColor);
    }

    for (let y = 1; y < bottom; y += 1) {
        placeGlyph(grid, 0, y, glyphs.left, 1, "", "", borderColor);
        placeGlyph(grid, right, y, glyphs.right, 1, "", "", borderColor);
    }

    placeGlyph(grid, 0, 0, glyphs.topLeft, 1, "", "", borderColor);
    placeGlyph(grid, right, 0, glyphs.topRight, 1, "", "", borderColor);
    placeGlyph(grid, right, bottom, glyphs.bottomRight, 1, "", "", borderColor);
    placeGlyph(grid, 0, bottom, glyphs.bottomLeft, 1, "", "", borderColor);

    return grid;
}

export function layoutView(
    input: ViewLayoutInput,
    constraints: LayoutConstraints = {},
): LayoutResult {
    const { style } = input;
    const isFlex = style.display === "flex";
    const direction = style.flexDirection ?? "row";
    const explicitWidth = normalizeCellCount(style.width);
    const explicitHeight = normalizeCellCount(style.height);
    const fixedWidth = resolveOwnDimension(
        explicitWidth,
        constraints.stretchWidth,
    );
    const fixedHeight = resolveOwnDimension(
        explicitHeight,
        constraints.stretchHeight,
    );
    const initialChildren = layoutChildren(
        input.children,
        isFlex ? undefined : fixedWidth ?? normalizeCellCount(constraints.maxWidth),
    );
    const naturalSize = isFlex
        ? getNaturalFlexSize(initialChildren, direction)
        : {
            width: getNaturalBlockWidth(initialChildren),
            height: getNaturalBlockHeight(initialChildren),
        };
    const width = fixedWidth ?? constrainAutoDimension(
        naturalSize.width,
        constraints.maxWidth,
    );
    const height = fixedHeight ?? constrainAutoDimension(
        naturalSize.height,
        constraints.maxHeight,
    );
    const children = isFlex
        ? stretchFlexChildren(
            initialChildren,
            direction,
            direction === "row" ? height : width,
            style.alignItems ?? "stretch",
        )
        : initialChildren;
    const records = isFlex
        ? placeFlexChildren(
            children,
            width,
            height,
            direction,
            style.justifyContent,
            style.alignItems ?? "stretch",
        )
        : placeBlockChildren(children);
    const padding = resolveSpacing(style, "padding");
    const borderOffset = hasBorder(style) ? 1 : 0;
    const content = paintRecords(
        records,
        width,
        height,
        padding.left + borderOffset,
        padding.top + borderOffset,
    );

    return {
        grid: addBorder(
            paintViewBackground(addPadding(content, style), style),
            style,
        ),
        margin: resolveSpacing(style, "margin"),
        position: resolvePosition(style),
        autoWidth: explicitWidth === undefined &&
            constraints.stretchWidth === undefined,
        autoHeight: explicitHeight === undefined &&
            constraints.stretchHeight === undefined,
    };
}
