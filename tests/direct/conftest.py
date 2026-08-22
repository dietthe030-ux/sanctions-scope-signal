"""Dependency-free contract harness for the installed GenLayer test package.

The host has genlayer-test 0.1.2, whose published wheel exposes the legacy pytest
plugin but omits the newer Direct Mode modules documented by GenLayer. This harness
models only the SDK surfaces used by this contract. Studionet remains the authority
for runtime and consensus behavior after PRE_DEPLOY approval.
"""

from contextlib import contextmanager
import importlib.util
import html
from pathlib import Path
import re
import sys
import types
import uuid

import pytest


class FakeAddress:
    def __init__(self, value):
        self.as_hex = str(value)

    def __str__(self):
        return self.as_hex


class TreeMap(dict):
    pass


class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class CodeSlot:
    def __init__(self, root):
        self.root = root
        self.value = b"v1"

    def get(self):
        return self

    def _authorize(self):
        if self.root.vm.sender.as_hex not in [address.as_hex for address in self.root.upgraders.get()]:
            raise UserError("unauthorized upgrader")

    def truncate(self):
        self._authorize()
        self.value = b""

    def extend(self, value):
        self._authorize()
        self.value += value


class UpgraderSlot(list):
    def get(self):
        return self


class FakeRoot:
    def __init__(self, vm):
        self.vm = vm
        self.upgraders = UpgraderSlot()
        self.code = CodeSlot(self)


class RootAccessor:
    current = None

    @classmethod
    def get(cls):
        return cls.current


class Response:
    def __init__(self, status, body):
        self.status_code = status
        self.body = body.encode("utf-8") if isinstance(body, str) else body


class PublicWrite:
    def __call__(self, fn):
        return fn


class Public:
    write = PublicWrite()

    @staticmethod
    def view(fn):
        return fn


class Contract:
    def __new__(cls, *args, **kwargs):
        instance = super().__new__(cls)
        for name, annotation in getattr(cls, "__annotations__", {}).items():
            if getattr(annotation, "__origin__", None) is TreeMap:
                setattr(instance, name, TreeMap())
        return instance


class DirectVM:
    def __init__(self, sdk):
        self.sdk = sdk
        self.web_mocks = []
        self.llm_mocks = []
        self.strict_mocks = False
        self.validator = None
        self.leader_value = None
        self.sender = FakeAddress("0x00000000000000000000000000000000000000a1")

    def mock_web(self, pattern, response):
        self.web_mocks.append([re.compile(pattern), response, 0])

    def mock_llm(self, pattern, response):
        self.llm_mocks.append([re.compile(pattern, re.IGNORECASE | re.DOTALL), response, 0])

    def clear_mocks(self):
        self.web_mocks.clear()
        self.llm_mocks.clear()

    def find_web(self, url):
        for pattern, response, _ in self.web_mocks:
            if pattern.search(url):
                for item in self.web_mocks:
                    if item[0] is pattern:
                        item[2] += 1
                return Response(response.get("status", 200), response.get("body", ""))
        raise UserError(f"No web mock matched {url}")

    def find_llm(self, prompt):
        for pattern, response, _ in self.llm_mocks:
            if pattern.search(prompt):
                for item in self.llm_mocks:
                    if item[0] is pattern:
                        item[2] += 1
                return response
        raise UserError("No LLM mock matched the prompt")

    def run_nondet_unsafe(self, leader_fn, validator_fn):
        value = leader_fn()
        self.leader_value = value
        self.validator = validator_fn
        return value

    def run_validator(self):
        if self.validator is None:
            raise AssertionError("No validator was captured")
        return self.validator(Return(self.leader_value))

    @contextmanager
    def expect_revert(self, message):
        with pytest.raises(UserError, match=re.escape(message)):
            yield


def build_sdk():
    module = types.ModuleType("genlayer")
    sdk = types.SimpleNamespace()
    vm = DirectVM(sdk)
    message = types.SimpleNamespace(sender_address=vm.sender)
    gl = types.SimpleNamespace(
        Contract=Contract,
        public=Public(),
        message=message,
        vm=types.SimpleNamespace(
            UserError=UserError,
            Return=Return,
            run_nondet_unsafe=vm.run_nondet_unsafe,
        ),
        nondet=types.SimpleNamespace(
            web=types.SimpleNamespace(
                get=vm.find_web,
                render=lambda url, mode="html", **kwargs: (
                    "<html><body>"
                    + html.escape(vm.find_web(url).body.decode("utf-8"))
                    + "</body></html>"
                ),
            ),
            exec_prompt=lambda prompt, response_format=None: vm.find_llm(prompt),
        ),
        storage=types.SimpleNamespace(Root=RootAccessor),
    )
    module.gl = gl
    module.TreeMap = TreeMap
    module.u256 = int
    module.Address = FakeAddress
    module.__all__ = ["gl", "TreeMap", "u256", "Address"]
    sdk.module = module
    sdk.gl = gl
    sdk.vm = vm
    return sdk


@pytest.fixture
def harness():
    sdk = build_sdk()
    sys.modules["genlayer"] = sdk.module
    yield sdk
    sys.modules.pop("genlayer", None)


@pytest.fixture
def direct_vm(harness):
    vm = harness.vm

    class SenderProxy:
        def __getattr__(self, name):
            return getattr(vm, name)

        def __setattr__(self, name, value):
            if name == "sender":
                vm.sender = value
                harness.gl.message.sender_address = value
            else:
                setattr(vm, name, value)

    return SenderProxy()


@pytest.fixture
def direct_deploy(harness):
    def deploy(path, *args):
        absolute = Path(path).resolve()
        name = f"contract_under_test_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, absolute)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        contract_type = next(
            value
            for value in vars(module).values()
            if isinstance(value, type) and issubclass(value, Contract) and value is not Contract
        )
        RootAccessor.current = FakeRoot(harness.vm)
        contract = contract_type(*args)
        contract._test_root = RootAccessor.current
        return contract

    return deploy


@pytest.fixture
def direct_bob():
    return FakeAddress("0x00000000000000000000000000000000000000b2")
