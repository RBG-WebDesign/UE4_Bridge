#include "WidgetChildAttachment.h"
#include "Components/PanelWidget.h"
#include "Components/PanelSlot.h"
#include "Components/Widget.h"

UPanelSlot* FWidgetChildAttachment::AttachChild(UWidget* Parent, UWidget* Child, const FString& Path, FString& OutError)
{
    if (!Parent || !Child)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Null parent or child in attachment"), *Path);
        return nullptr;
    }

    UPanelWidget* Panel = Cast<UPanelWidget>(Parent);
    if (Panel)
    {
        return AttachToPanel(Panel, Child, Path, OutError);
    }

    // If parent is not a panel, attachment is not supported (content widgets added in Pass 4)
    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Parent '%s' is not a panel widget, cannot attach children"),
        *Path, *Parent->GetName());
    return nullptr;
}

UPanelSlot* FWidgetChildAttachment::AttachToPanel(UPanelWidget* Panel, UWidget* Child, const FString& Path, FString& OutError)
{
    Panel->AddChild(Child);

    if (!Child->Slot)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Slot is null after attaching '%s' to panel '%s'"),
            *Path, *Child->GetName(), *Panel->GetName());
        return nullptr;
    }

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: Attached '%s' to panel '%s'"),
        *Path, *Child->GetName(), *Panel->GetName());

    return Child->Slot;
}
