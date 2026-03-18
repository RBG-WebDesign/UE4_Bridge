#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonValue.h"

class UWidget;

class FWidgetPropertyApplier
{
public:
    /**
     * Apply widget-level properties from JSON values to the constructed widget.
     * Handles common properties (visibility, renderOpacity, isEnabled) and
     * type-specific properties (TextBlock text/justification/color).
     */
    static bool ApplyProperties(
        UWidget* Widget,
        const FString& TypeName,
        const TMap<FString, TSharedPtr<FJsonValue>>& Properties,
        const FString& Path,
        FString& OutError);
};
