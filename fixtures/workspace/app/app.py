import reflex as rx


class State(rx.State):
    count: int = 0

    def bump(self):
        self.count += 1
        return rx.call_script("console.log('bumped')")


def index():
    return rx.center(
        rx.vstack(
            rx.heading("Demo", class_name="text-4xl font-bold text-blue-500"),
            rx.text(f"count: {State.count}", class_name="text-sm text-gray-600"),
            rx.button(
                "bump",
                on_click=State.bump,
                class_name="rounded-md px-4 py-2 hover:bg-blue-100",
            ),
            style={"font_family": "monospace", "padding": "2rem"},
        )
    )


app = rx.App()
app.add_page(index)
