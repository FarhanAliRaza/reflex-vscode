import reflex as rx
from reflex.vars import Var


class State(rx.State):
    def play(self):
        return rx.call_script("playFromStart(button_sfx)")

    def get_location(self):
        return rx.call_script(
            "window.location", callback=State.update_location
        )

    def scroll(self):
        return rx.run_script("window.scrollTo({top: 0, behavior: 'smooth'})")

    def call(self):
        return rx.call_function("() => window.confirm('sure?')")


filter_var = rx.Var("((edge) => edge.id !== 'e1')")
spread = Var(_js_expr="{...searchBarProps}")
special = Var("{...searchBarProps}")


def index():
    return rx.box(
        rx.script("console.log('inline javascript')"),
        rx.script("""
            var button_sfx = new Audio("/sounds/click.mp3");
            function playFromStart(sfx) {
                sfx.currentTime = 0;
                sfx.play();
            }
        """),
    )
