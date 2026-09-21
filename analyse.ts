/*
 * UME lite2
 * 解析処理
 *
 * DOMの描画は行わない。
 * 現在のテキスト・カーソル・表示幅などから
 * 必要な情報を計算して返す。
 */


/* ============================================
   文字幅から、おおよその1行文字数を求める
   ============================================ */

export function analyseCharsPerLine(
    editor: HTMLElement
): number {

    const style = getComputedStyle(editor);

    const contentWidth =
        editor.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight);

    const charWidth =
        measureCharacterWidth(editor);

    if (charWidth <= 0) {
        return 0;
    }

    return Math.floor(
        contentWidth / charWidth
    );
}


/* ============================================
   文字幅測定
   ============================================ */

function measureCharacterWidth(
    editor: HTMLElement
): number {

    const measure =
        document.createElement("span");

    const style =
        getComputedStyle(editor);

    measure.textContent = "M";

    measure.style.position = "absolute";
    measure.style.visibility = "hidden";
    measure.style.whiteSpace = "pre";

    measure.style.fontFamily =
        style.fontFamily;

    measure.style.fontSize =
        style.fontSize;

    measure.style.fontWeight =
        style.fontWeight;

    measure.style.letterSpacing =
        style.letterSpacing;

    document.body.appendChild(measure);

    const width =
        measure.getBoundingClientRect().width;

    measure.remove();

    return width;
}


/* ============================================
   各論理行の開始位置を求める
   ============================================ */

export function analyseLineStarts(
    text: string
): number[] {

    const lineStarts: number[] = [0];

    for (
        let i = 0;
        i < text.length;
        i++
    ) {
        if (text[i] === "\n") {
            lineStarts.push(i + 1);
        }
    }

    return lineStarts;
}


/* ============================================
   カーソル位置から論理行とXを求める
   ============================================ */

export function analyseCursorPosition(
    cursor: number,
    lineStarts: number[]
): {
    line: number;
    x: number;
} {

    if (lineStarts.length === 0) {
        return {
            line: 0,
            x: 0
        };
    }

    let low = 0;
    let high =
        lineStarts.length - 1;

    while (low <= high) {

        const mid =
            Math.floor(
                (low + high) / 2
            );

        if (
            lineStarts[mid] <= cursor
        ) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const line =
        Math.max(0, high);

    const x =
        cursor - lineStarts[line];

    return {
        line,
        x
    };
}


/* ============================================
   指定した論理行の文字列を取得
   ============================================ */

export function analyseLineText(
    text: string,
    line: number,
    lineStarts: number[]
): string {

    if (
        line < 0 ||
        line >= lineStarts.length
    ) {
        return "";
    }

    const start =
        lineStarts[line];

    const end =
        line + 1 < lineStarts.length
            ? lineStarts[line + 1] - 1
            : text.length;

    return text.slice(
        start,
        end
    );
}


/* ============================================
   文字列の折り返し行数を測定
   ============================================ */

const wrapMeasure = document.createElement("div");

wrapMeasure.style.position = "absolute";
wrapMeasure.style.visibility = "hidden";
wrapMeasure.style.whiteSpace = "pre-wrap";
wrapMeasure.style.overflowWrap = "break-word";
wrapMeasure.style.boxSizing = "border-box";

document.body.appendChild(wrapMeasure);

export function analyseWrappedLineCount(
    lineText: string,
    editor: HTMLElement
): number {

    /*
     * 空行はブラウザの測定DIVでは
     * 高さ0になるため、論理上1行として扱う。
     */

    if (lineText.length === 0) {
        return 1;
    }

    const style = getComputedStyle(editor);

    wrapMeasure.style.width =
        `${editor.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight)}px`;

    wrapMeasure.style.fontFamily =
        style.fontFamily;

    wrapMeasure.style.fontSize =
        style.fontSize;

    wrapMeasure.style.fontWeight =
        style.fontWeight;

    wrapMeasure.style.lineHeight =
        style.lineHeight;

    wrapMeasure.style.letterSpacing =
        style.letterSpacing;

    wrapMeasure.textContent = lineText;

    const height =
        wrapMeasure.getBoundingClientRect().height;

    const lineHeight =
        parseFloat(style.lineHeight);

    if (
        lineHeight <= 0 ||
        height <= 0
    ) {
        return 1;
    }

    return Math.max(
        1,
        Math.round(
            height / lineHeight
        )
    );
}

/* ============================================
   カーソル位置までの折り返し高さ
   ============================================ */

export function analyseCursorWrappedHeight(
    lineText: string,
    x: number,
    editor: HTMLElement
): number {

    /*
     * 行頭は必ず第0折り返し行。
     * 空文字列をDIVに入れても
     * ブラウザは高さ0を返すため、
     * ここでは0を返す。
     */

    if (x <= 0) {
        return 0;
    }

    const measure =
        document.createElement("div");

    const style =
        getComputedStyle(editor);

    measure.style.position = "absolute";
    measure.style.visibility = "hidden";

    measure.style.whiteSpace =
        "pre-wrap";

    measure.style.overflowWrap =
        "break-word";

    measure.style.boxSizing =
        "border-box";

    measure.style.width =
        `${editor.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight)}px`;

    measure.style.fontFamily =
        style.fontFamily;

    measure.style.fontSize =
        style.fontSize;

    measure.style.fontWeight =
        style.fontWeight;

    measure.style.lineHeight =
        style.lineHeight;

    measure.style.letterSpacing =
        style.letterSpacing;

    measure.textContent =
        lineText.slice(0, x);

    document.body.appendChild(measure);

    const height =
        measure.getBoundingClientRect().height;

    measure.remove();

    return height;
}


/* ============================================
   折り返し高さから折り返し行番号を求める
   ============================================ */

export function analyseWrappedRow(
    height: number,
    lineHeight: number
): number {

    if (
        height <= 0 ||
        lineHeight <= 0
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.floor(
            height / lineHeight
        ) - 1
    );
}
