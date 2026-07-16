import reflex as rx


class ColorPicker(rx.Component):
    library = "react-colorful"
    tag = "HexColorPicker"

    def add_hooks(self) -> list[str]:
        """Add the hooks for the component."""
        return [
            """
            useEffect(() => {
                const handler = (e) => console.log(e.key);
                document.addEventListener("keydown", handler);
                return () => document.removeEventListener("keydown", handler);
            }, [])
            """,
            'const customHookVariable = "some value";',
        ]

    def add_custom_code(self) -> list[str]:
        return [
            """
            const ChartExample = () => {
                const [data, setData] = useState([1, 2, 3]);
                return (
                    <div className="chart">
                        {data.map((d) => <span key={d}>{d}</span>)}
                    </div>
                );
            };
            """
        ]

    def _get_custom_code(self) -> str:
        return "import 'reactflow/dist/style.css';"
