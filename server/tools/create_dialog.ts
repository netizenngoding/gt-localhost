/**
 * Modular V1.50 DialogBuilder modeled on Gurotopia's `tools/create_dialog.hpp`,
 * strictly emitting commands verified inside `ReGrowtopia-1.50.wasm`.
 */
export class DialogBuilder {
  private lines: string[] = ["set_default_color|`o"];

  public setDefaultColor(colorCode: string): this {
    this.lines[0] = `set_default_color|${colorCode}`;
    return this;
  }

  public addLabel(size: "big" | "small", text: string, align: "left" | "center" | "right" = "left"): this {
    this.lines.push(`add_label|${size}|${text}|${align}|`);
    return this;
  }

  public addLabelWithIcon(
    size: "big" | "small",
    text: string,
    itemId: number,
    align: "left" | "center" | "right" = "left"
  ): this {
    this.lines.push(`add_label_with_icon|${size}|${text}|${align}|${itemId}|`);
    return this;
  }

  /** Native add_achieve uses game/amorkolg.rttex, not an inventory item. */
  public addAchievement(title: string, status: string, icon: number): this {
    if (!Number.isInteger(icon) || icon < 0 || icon > 127) throw new RangeError("Invalid achievement atlas index");
    const clean = (value: string) => value.replace(/[|\r\n\0]/g, " ");
    this.lines.push(`add_achieve|${clean(title)}|${clean(status)}|left|${icon}|`);
    return this;
  }

  public addTextbox(text: string, align: "left" | "center" | "right" = "left"): this {
    this.lines.push(`add_textbox|${text}|${align}|`);
    return this;
  }

  public addSmallText(text: string, align: "left" | "center" | "right" = "left"): this {
    this.lines.push(`add_smalltext|${text}|${align}|`);
    return this;
  }

  public addSmalltext(text: string, align: "left" | "center" | "right" = "left"): this {
    return this.addSmallText(text, align);
  }

  public addTextInput(name: string, label: string, defaultValue: string | number, maxLen: number): this {
    this.lines.push(`add_text_input|${name}|${label}|${defaultValue}|${maxLen}|`);
    return this;
  }

  public addTextInputPassword(name: string, label: string, defaultValue: string, maxLen: number): this {
    this.lines.push(`add_text_input_password|${name}|${label}|${defaultValue}|${maxLen}|`);
    return this;
  }

  public addTextBoxInput(name: string, label: string, defaultValue: string, maxLen: number, lines = 3): this {
    this.lines.push(`add_text_box_input|${name}|${label}|${defaultValue}|${maxLen}|${lines}|`);
    return this;
  }

  public customSpacing(x:number,y:number):this {
    this.lines.push(`set_custom_spacing|x:${x};y:${y}|`); return this;
  }
  public customButton(name:string,image:string):this {
    this.lines.push(`add_custom_button|${name}|image:interface/large/${image}.rttex;image_size:400,260;width:0.19;|`); return this;
  }
  public customBreak():this { this.lines.push('add_custom_break|'); return this; }
  public addButton(name: string, label: string, flags = "noflags"): this {
    this.lines.push(`add_button|${name}|${label}|${flags}|0|0|`);
    return this;
  }

  public addSmallFontButton(name: string, label: string, flags = "noflags"): this {
    this.lines.push(`add_small_font_button|${name}|${label}|${flags}|0|0|`);
    return this;
  }

  public addButtonWithIcon(
    name: string,
    label: string,
    frameOrItemId:
      | "noflags"
      | "staticBlueFrame"
      | "staticYellowFrame"
      | "staticPurpleFrame"
      | "staticRedFrame"
      | "frame"
      | number,
    itemIdOrFrame:
      | number
      | "noflags"
      | "staticBlueFrame"
      | "staticYellowFrame"
      | "staticPurpleFrame"
      | "staticRedFrame"
      | "frame" = "staticBlueFrame",
    countText: string | number = ""
  ): this {
    const frame = typeof frameOrItemId === "number" ? itemIdOrFrame : frameOrItemId;
    const itemId = typeof frameOrItemId === "number" ? frameOrItemId : Number(itemIdOrFrame);
    this.lines.push(`add_button_with_icon|${name}|${label}|${frame}|${itemId}|${countText}|`);
    return this;
  }

  public endButtonWithIconList(): this {
    this.lines.push("add_button_with_icon||END_LIST|noflags|0||");
    return this;
  }

  public addImageButton(name: string, rttexPath: string, flags = "bannerlayout"): this {
    this.lines.push(`add_image_button|${name}|${rttexPath}|${flags}|||`);
    return this;
  }

  public addUrlButton(name: string, label: string, url: string, tooltip = "Open link?", flags = "noflags"): this {
    this.lines.push(`add_url_button|${name}|${label}|${flags}|${url}|${tooltip}|0|0|`);
    return this;
  }

  public addCheckbox(name: string, label: string, checked: boolean): this {
    this.lines.push(`add_checkbox|${name}|${label}|${checked ? 1 : 0}|`);
    return this;
  }

  public addItemPicker(name: string, label: string, promptText = "Choose an item"): this {
    this.lines.push(`add_item_picker|${name}|${label}|${promptText}|`);
    return this;
  }

  public addPlayerPicker(name: string, label: string): this {
    this.lines.push(`add_player_picker|${name}|${label}|`);
    return this;
  }

  public addPlayerInfo(
    playerName: string,
    level: number,
    xpCurrent: number,
    xpRequired: number
  ): this {
    this.lines.push(`add_player_info|${playerName}|${level}|${xpCurrent}|${xpRequired}|`);
    return this;
  }

  public addSpacer(size: "small" | "big" = "small"): this {
    this.lines.push(`add_spacer|${size}|`);
    return this;
  }

  public addQuickExit(): this {
    this.lines.push("add_quick_exit|");
    return this;
  }

  public embedData(key: string, value: string | number): this {
    this.lines.push(`embed_data|${key}|${value}`);
    return this;
  }

  public raw(line: string): this {
    const cleaned = line.replace(/\n+$/, "");
    if (cleaned) this.lines.push(cleaned);
    return this;
  }

  public endDialog(name: string, cancelBtn = "", acceptBtn = ""): string {
    this.lines.push(`end_dialog|${name}|${cancelBtn}|${acceptBtn}|`);
    return this.lines.join("\n");
  }
}
