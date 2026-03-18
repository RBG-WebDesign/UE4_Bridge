#pragma once

#include "CoreMinimal.h"

class UWidget;
class UPanelWidget;

class FWidgetChildAttachment
{
public:
    bool AttachChild(UWidget* Parent, UWidget* Child, const FString& Path, FString& OutError);

private:
    bool AttachToPanel(UPanelWidget* Panel, UWidget* Child, const FString& Path, FString& OutError);
};
