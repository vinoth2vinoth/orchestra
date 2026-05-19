import logging
from dataclasses import dataclass
from typing import List, Dict, Any

logger = logging.getLogger("ToolRegistry")

@dataclass
class ToolDefinition:
    name: str
    description: str
    domains: List[str]
    do_not_use_when: List[str]

class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, ToolDefinition] = {}
        self._pre_register()

    def _pre_register(self):
        # 1. Stripe SDK
        self.register(ToolDefinition(
            name="stripe_sdk",
            description="Specialized SDK integration for all Stripe payment and subscription operations.",
            domains=["payments", "subscriptions", "billing"],
            do_not_use_when=["Working with non-Stripe providers"]
        ))
        
        # 2. Generic HTTP Client
        self.register(ToolDefinition(
            name="http_client",
            description="Generic HTTP web request dispatcher.",
            domains=["api", "web"],
            do_not_use_when=["A specialized integration (like Stripe SDK) exists for the target domain", "Authentication requires complex OAuth flows better suited for a dedicated SDK"]
        ))
        
        # 3. Search Engine
        self.register(ToolDefinition(
            name="search_engine",
            description="Broad web search utility.",
            domains=["research", "web_scraping"],
            do_not_use_when=["Searching for internal enterprise data"]
        ))

        # 4. Employee DB Tool
        self.register(ToolDefinition(
            name="employee_db_tool",
            description="Internal database query tool for HR and executive data.",
            domains=["hr", "internal_db"],
            do_not_use_when=["User does not have authorization", "Information is public"]
        ))

        # 5. Web Scraper
        self.register(ToolDefinition(
            name="web_scraper",
            description="DOM extraction tool.",
            domains=["data_extraction", "web"],
            do_not_use_when=["API access is available for the target site"]
        ))
        
        # 6. CSV Parser
        self.register(ToolDefinition(
             name="csv_parser",
             description="Parses tabular flat files.",
             domains=["data_transformation"],
             do_not_use_when=["Data is highly nested JSON that requires deep recursion"]
        ))

        # 7. JSON Transformer
        self.register(ToolDefinition(
             name="json_transformer",
             description="Recursive nested object graph manipulator.",
             domains=["data_transformation"],
             do_not_use_when=["Data is strictly flat tabular (use CSV Parser)"]
        ))

    def register(self, tool: ToolDefinition):
        self.tools[tool.name] = tool
        
    def select_tool(self, task_context: str, domain: str) -> str:
        """
        Selects best tool enforcing DO NOT USE WHEN anti-patterns.
        """
        logger.info(f"Selecting tools for domain: {domain}")
        candidate = None
        
        # Look for specialized tools first
        if "stripe" in task_context.lower() or "subscription" in task_context.lower():
            candidate = "stripe_sdk"
        elif "employee" in task_context.lower() or "executives" in task_context.lower():
            candidate = "employee_db_tool"
            
        if candidate and candidate in self.tools:
            logger.info(f"Selected specialized tool: {candidate}")
            return candidate
            
        # Fallback to generic if valid
        logger.warning(f"No strict specific SDK found. Resorting to generic matches for domain {domain}.")
        for t_name, t_def in self.tools.items():
            if domain in t_def.domains:
                 # Check anti-patterns explicitly
                 anti_pattern_violation = False
                 for condition in t_def.do_not_use_when:
                     if "specialized integration" in condition and candidate:
                         anti_pattern_violation = True
                         break
                 
                 if not anti_pattern_violation:
                     return t_name
                     
        return "none"
