import reflex as rx

node_id = "e1"

filter_var = rx.Var(f"((edge) => edge.id !== {node_id})")

script = rx.call_script(
    f"""
    const el = document.getElementById({node_id});
    el.scrollIntoView({{behavior: "smooth"}});
    """
)


def index():
    return rx.box(
        rx.text("x", class_name=f"p-4 text-{node_id} shadow-lg"),
        rx.text("y", background_image=f"url({node_id}.png)"),
    )
