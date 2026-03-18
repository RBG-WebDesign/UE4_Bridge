#include "WidgetChildAttachment.h"
#include "Components/PanelWidget.h"
#include "Components/Widget.h"

bool FWidgetChildAttachment::AttachChild(UWidget* Parent, UWidget* Child, const FString& Path, FString& OutError)
{
    if (!Parent || !Child)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Null parent or child in attachment"), *Path);
        return false;
    }

    UPanelWidget* Panel = Cast<UPanelWidget>(Parent);
    if (Panel)
    {
        return AttachToPanel(Panel, Child, Path, OutError);
    }

    // If parent is not a panel, attachment is not supported (content widgets added in Pass 4)
    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Parent '%s' is not a panel widget, cannot attach children"),
        *Path, *Parent->GetName());
    return false;
}

bool FWidgetChildAttachment::AttachToPanel(UPanelWidget* Panel, UWidget* Child, const FString& Path, FString& OutError)
{
    Panel->AddChild(Child);

    if (!Child->Slot)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Slot is null after attaching '%s' to panel '%s'"),
            *Path, *Child->GetName(), *Panel->GetName());
        return false;
    }

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: Attached '%s' to panel '%s'"),
        *Path, *Child->GetName(), *Panel->GetName());

    return true;
}
