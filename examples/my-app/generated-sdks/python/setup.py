from setuptools import setup, find_packages

setup(
    name="axiomify-sdk-python",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "httpx>=0.24.0",
        "pydantic>=2.0.0"
    ],
    python_requires=">=3.8",
)
