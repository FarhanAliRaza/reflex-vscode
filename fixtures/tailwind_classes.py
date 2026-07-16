import reflex as rx


def index():
    return rx.box(
        rx.text("hello", class_name="text-4xl text-center text-blue-500"),
        rx.box(class_name="h-5 rounded-md border hover:bg-secondary-3 rounded-[2px]"),
        rx.box(class_name=["flex", "items-center", "gap-2"]),
        rx.box(class_name=f"p-4 {extra_classes}"),
        class_name="mx-auto max-w-3xl",
    )


extra_classes = "shadow-lg"
