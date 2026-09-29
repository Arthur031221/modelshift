import os

from anthropic import Anthropic
from openai import OpenAI

openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def classify(ticket: str) -> str:
    response = openai_client.chat.completions.create(
        model="gpt-4o-2024-05-13",
        temperature=0.2,
        messages=[{"role": "user", "content": f"Classify this ticket: {ticket}"}],
    )
    return response.choices[0].message.content or ""


def summarize(document: str) -> str:
    response = anthropic_client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=512,
        temperature=0.7,
        top_p=0.9,
        system="Think step by step before answering. Summarize the document in three bullets.",
        messages=[{"role": "user", "content": document}],
    )
    return response.content[0].text
