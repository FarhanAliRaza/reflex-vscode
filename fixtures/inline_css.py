import reflex as rx

style = {
    "font_family": "Comic Sans MS",
    "font_size": "16px",
    "box_shadow": "rgba(240, 46, 170, 0.4) 5px 5px",
    "::selection": {"background_color": "lightblue"},
    rx.text: {"color": "blue"},
}

app = rx.App(style=style)


def index():
    return rx.box(
        rx.text(
            "gradient",
            background_image="linear-gradient(271.68deg, #EE756A 0.75%, #756AEE 88.52%)",
            font_weight="bold",
        ),
        rx.text(
            "hover me",
            _hover={"color": "red", "text_decoration": "underline"},
            style={"width": "500px", "white-space": "pre-wrap"},
        ),
        rx.image(src="/logo.png", alt="logo", size="3"),
        rx.el.style("""
            .container { display: flex; }
            .container > p { margin: 0 auto; }
        """),
    )


def add_style():
    return rx.Style({"backgroundColor": "red", "padding": "10px"})
