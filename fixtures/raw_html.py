import reflex as rx


def index():
    return rx.box(
        rx.html("<h2>Hello World</h2>"),
        rx.html("""
            <div class="card">
                <img src="/logo.png" alt="logo" />
                <p style="color: red">embedded html</p>
            </div>
        """),
    )
