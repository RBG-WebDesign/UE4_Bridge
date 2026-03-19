# Skill: generate_cpp_classes

Write UE4.27-compatible C++ class files for UCLASS types.

## File naming convention
- `AClassName` -> `ClassName.h` / `ClassName.cpp`
- Place under `Source/<ModuleName>/Generated/`
- Must include `ClassName.generated.h` (last include in .h)

## UCLASS macro patterns

### Actor
```cpp
UCLASS()
class PROJECTNAME_API AMyActor : public AActor {
    GENERATED_BODY()
public:
    AMyActor();
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="MyActor")
    float MyFloat = 0.f;
    UFUNCTION(BlueprintCallable, Category="MyActor")
    void MyFunction();
protected:
    virtual void BeginPlay() override;
public:
    virtual void Tick(float DeltaTime) override;
};
```

### ActorComponent
```cpp
UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class PROJECTNAME_API UMyComponent : public UActorComponent {
    GENERATED_BODY()
public:
    UMyComponent();
protected:
    virtual void BeginPlay() override;
public:
    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
        FActorComponentTickFunction* ThisTickFunction) override;
};
```

### GameModeBase
```cpp
UCLASS()
class PROJECTNAME_API AMyGameMode : public AGameModeBase {
    GENERATED_BODY()
public:
    AMyGameMode();
};
```

## Parent class -> include path map
| Parent class | Include |
|---|---|
| AActor | GameFramework/Actor.h |
| APawn | GameFramework/Pawn.h |
| ACharacter | GameFramework/Character.h |
| APlayerController | GameFramework/PlayerController.h |
| AGameModeBase | GameFramework/GameModeBase.h |
| AGameStateBase | GameFramework/GameStateBase.h |
| AAIController | AIController.h |
| UGameInstance | Engine/GameInstance.h |
| UActorComponent | Components/ActorComponent.h |
| USaveGame | GameFramework/SaveGame.h |

## Implementation
```python
# generation/cpp_generator.py
write_all_cpp_classes(spec.cpp_classes, "D:/Unreal Projects/CodePlayground/Source")
```

## After writing files
Re-run UBT to compile. See `compile_project_and_repair` skill.
