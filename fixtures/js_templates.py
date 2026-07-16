import reflex as rx


class Themed(rx.Component):
    def add_hooks(self) -> list[str]:
        return [
            """
            const searchBarProps = {
              styles: [
                {
                  key: "custom-theme",
                  type: "style",
                  value: /* css */ `
                    [data-theme='light'] .ikp-search-bar__button {
                      color: var(--secondary-11);
                      padding: 0.375rem 0.5rem;
                      border-radius: 0.5rem;
                      background: ${bg};
                    }
                  `,
                },
              ],
            };
            """
        ]


snippet = rx.call_script("""
    const tpl = /* html */ `<div class="card"><p>hello</p></div>`;
    document.body.insertAdjacentHTML("beforeend", tpl);
""")
