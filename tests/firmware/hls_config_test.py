"""Check component loading and select extension with installed ESPHome APIs.

No code generation, dependency download or firmware/decoder build is performed.
"""
import importlib.util
from pathlib import Path
import sys
import unittest

if importlib.util.find_spec("esphome") is None:
    print("SKIP: install ESPHome to run HLS configuration integration tests")
    sys.exit(77)

from esphome.config_helpers import merge_config
from esphome.yaml_util import load_yaml

ROOT = Path(__file__).resolve().parents[2]


class HlsConfigurationTest(unittest.TestCase):
    def test_component_imports_with_installed_esphome(self):
        spec = importlib.util.spec_from_file_location(
            "hls_screensaver_config", ROOT / "components/hls_screensaver/__init__.py")
        component = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(component)
        self.assertTrue(callable(component.CONFIG_SCHEMA))

    def test_select_extension_preserves_existing_actions(self):
        base = load_yaml(ROOT / "common/config/display.yaml")
        extension = load_yaml(ROOT / "common/device/screen_hls.yaml")
        action = next(item for item in base["select"] if item.get("id") == "screensaver_action")
        # !extend merges the matching entity using this same ESPHome function.
        merged = merge_config(action, extension["select"][0])
        self.assertEqual(merged["options"], ["Display Off", "Screen Dimmed", "Clock", "HLS Stream"])
        handler = merged["on_value"]
        self.assertIsInstance(handler, dict, "extension must retain the base then/action chain")
        self.assertEqual(handler["then"][:-1], action["on_value"]["then"])
        self.assertEqual(handler["then"][-1], {"script.execute": "hls_settings_changed"})


if __name__ == "__main__":
    unittest.main()
