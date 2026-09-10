"""Hand-written SVG charts.

Avoids matplotlib: the image stays light and the output files stay vectorial and
readable as plain text, which helps anyone verifying the results by hand.
"""

from __future__ import annotations

PALETTE = ["#2f7d63", "#b4541e", "#4a5aa8", "#8a6d1f", "#7a3060"]


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _tick(value: float, span: float) -> str:
    """Format an axis tick with enough decimals for the range it sits in.

    Populations run into the thousands and want whole numbers; a gene runs from
    nought to one and needs two decimals, or every label on the axis rounds to the
    same "0" and "1" and the axis says nothing at all.
    """
    step = span / 5.0
    if step >= 10:
        return f"{value:.0f}"
    if step >= 1:
        return f"{value:.1f}".rstrip("0").rstrip(".")
    if step >= 0.1:
        return f"{value:.2f}"
    return f"{value:.3f}"


def line_chart(
    title: str,
    series: list[tuple[str, list[tuple[float, float]]]],
    x_label: str = "generation",
    y_label: str = "",
    width: int = 900,
    height: int = 360,
    dashed: set[str] | None = None,
) -> str:
    dashed = dashed or set()
    left, right, top, bottom = 70, 210, 46, 52
    plot_w = width - left - right
    plot_h = height - top - bottom

    points = [p for _, data in series for p in data]
    if not points:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"></svg>'

    x_max = max(p[0] for p in points) or 1.0
    y_max = max(p[1] for p in points) or 1.0
    y_max *= 1.08

    def sx(x: float) -> float:
        return left + plot_w * (x / x_max)

    def sy(y: float) -> float:
        return top + plot_h * (1.0 - y / y_max)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="Helvetica,Arial,sans-serif">',
        f'<rect width="{width}" height="{height}" fill="#fbfaf7"/>',
        f'<text x="{left}" y="28" font-size="16" fill="#20201d">{_esc(title)}</text>',
    ]

    for i in range(6):
        y = top + plot_h * i / 5
        value = y_max * (1 - i / 5)
        out.append(f'<line x1="{left}" y1="{y:.1f}" x2="{left + plot_w}" y2="{y:.1f}" stroke="#e3e0d8"/>')
        out.append(
            f'<text x="{left - 10}" y="{y + 4:.1f}" font-size="11" fill="#6b6a63" '
            f'text-anchor="end">{_tick(value, y_max)}</text>'
        )
    for i in range(6):
        x = left + plot_w * i / 5
        out.append(
            f'<text x="{x:.1f}" y="{top + plot_h + 20}" font-size="11" fill="#6b6a63" '
            f'text-anchor="middle">{_tick(x_max * i / 5, x_max)}</text>'
        )

    out.append(
        f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" y2="{top + plot_h}" stroke="#a9a69c"/>'
    )
    out.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_h}" stroke="#a9a69c"/>')
    out.append(
        f'<text x="{left + plot_w / 2}" y="{height - 14}" font-size="12" fill="#6b6a63" '
        f'text-anchor="middle">{_esc(x_label)}</text>'
    )
    if y_label:
        out.append(
            f'<text x="18" y="{top + plot_h / 2}" font-size="12" fill="#6b6a63" '
            f'transform="rotate(-90 18 {top + plot_h / 2})" text-anchor="middle">{_esc(y_label)}</text>'
        )

    for index, (name, data) in enumerate(series):
        color = PALETTE[index % len(PALETTE)]
        if not data:
            continue
        path = " ".join(f"{'M' if i == 0 else 'L'}{sx(x):.1f},{sy(y):.1f}" for i, (x, y) in enumerate(data))
        stroke_dash = ' stroke-dasharray="5,3"' if name in dashed else ""
        out.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="1.6"{stroke_dash}/>')
        ly = top + 6 + index * 20
        out.append(
            f'<line x1="{left + plot_w + 22}" y1="{ly}" x2="{left + plot_w + 52}" y2="{ly}" '
            f'stroke="{color}" stroke-width="1.6"{stroke_dash}/>'
        )
        out.append(
            f'<text x="{left + plot_w + 60}" y="{ly + 4}" font-size="11" fill="#3a3934">{_esc(name)}</text>'
        )

    out.append("</svg>")
    return "\n".join(out)
