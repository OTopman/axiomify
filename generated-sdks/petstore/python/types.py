from typing import List, Dict, Optional, Any, Union
from enum import Enum
from datetime import datetime

class Pet:
    def __init__(self, **kwargs):
        self.id: int = kwargs.get('id')
        self.name: str = kwargs.get('name')
        self.tag: str = kwargs.get('tag')



