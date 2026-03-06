import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import MessageContent from "../../components/MessageContent";

describe("MessageContent", () => {
  afterEach(() => {
    cleanup();
  });

  it("escapes raw HTML instead of creating DOM nodes", () => {
    render(() => (
      <MessageContent content={'before <img src=x onerror="alert(1)"> after'} />
    ));

    expect(
      screen.getByText('before <img src=x onerror="alert(1)"> after')
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("neutralizes unsafe javascript links", () => {
    render(() => (
      <MessageContent content={"[click me](javascript:alert(1))"} />
    ));

    const link = screen.getByRole("link", { name: "click me" });
    expect(link).toHaveAttribute("href", "#");
  });

  it("preserves safe https links", () => {
    render(() => (
      <MessageContent content={"[OpenAI](https://openai.com)"} />
    ));

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
