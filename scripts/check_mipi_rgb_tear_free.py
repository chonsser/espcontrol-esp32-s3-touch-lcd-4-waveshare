#!/usr/bin/env python3
"""Exercise the local RGB option and framebuffer writer without display hardware."""

from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def check_schema() -> None:
    import esphome.components
    import esphome.config_validation as cv

    esphome.components.__path__.insert(0, str(ROOT / "components"))
    from esphome.components.mipi_rgb.display import model_schema

    for model in ("WAVESHARE-4-480X480", "GUITION-4848S040"):
        schema = model_schema({"model": model})
        option = cv.Schema({key: value for key, value in schema.schema.items()
                            if key.schema == "tear_free"})
        assert option({}).get("tear_free") is False, "tear_free must default to false"
        assert option({"tear_free": True})["tear_free"] is True
        assert option({"tear_free": False})["tear_free"] is False
        try:
            option({"tear_free": "invalid"})
        except cv.Invalid:
            pass
        else:
            raise AssertionError("tear_free must reject non-boolean values")
    print("mipi_rgb tear_free schema: ok")


def check_writer() -> None:
    # Compile the actual class and drawing methods against host peripheral stubs.
    # Setup/dump_config are verified by the firmware build, not source assertions.
    source = (ROOT / "components/mipi_rgb/mipi_rgb.cpp").read_text()
    start = source.index("void MipiRgb::loop()")
    end = source.index("static const char *get_pin_name", start)
    drawing = source[start:end]
    header = (ROOT / "components/mipi_rgb/mipi_rgb.h").read_text()
    header = header[header.index("namespace esphome::mipi_rgb {"):]
    header = header[:header.index("#ifdef USE_SPI")]
    with tempfile.TemporaryDirectory(prefix="mipi-rgb-test-") as directory:
        output = Path(directory)
        (output / "mipi_rgb_test.inc").write_text(
            header + drawing + "\n}  // namespace esphome::mipi_rgb\n"
        )
        # Compile the real Waveshare hooks too: recovery must schedule a whole
        # LVGL repaint, not merely stop failing the driver and lose flush chunks.
        import yaml

        document = yaml.compose((ROOT / "devices/waveshare-esp32-s3-touch-lcd-4/device/device.yaml").read_text())

        def value(node, key):
            return next(item for name, item in node.value if name.value == key)

        lvgl = value(document, "lvgl")
        hooks = []
        for event, function in (("on_draw_start", "waveshare_begin_frame"),
                                ("on_draw_end", "waveshare_end_frame")):
            code = value(value(lvgl, event).value[0], "lambda").value
            hooks.append(f"void {function}(TestDisplay &my_display, FakeLvgl &main_lvgl) {{\n{code}\n}}")
        (output / "waveshare_frame_hooks.inc").write_text("\n".join(hooks))
        binary = output / "mipi_rgb_test"
        subprocess.run([
            "c++", "-std=c++20", "-Wall", "-Wextra", "-Werror",
            "-Wno-unused-parameter", "-I", str(output),
            str(ROOT / "tests/firmware/mipi_rgb_tear_free_test.cpp"),
            "-o", str(binary),
        ], check=True)
        subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    check_schema()
    if "--schema-only" not in sys.argv:
        check_writer()
